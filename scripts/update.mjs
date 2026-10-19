// Reads projects.json, fetches repo info + latest stable/pre-release from GitHub, writes data.json.
// Repos that return 404 are moved from projects.json to offline.json (shown on offline.html).
// Usage: node scripts/update.mjs   (set GITHUB_TOKEN to avoid the 60 req/h anonymous limit)
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const headers = { Accept: "application/vnd.github+json", "User-Agent": "ps5-link-centralizer" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Authors often publish betas/nightlies without ticking "pre-release", so also look at the tag name.
// ponytail: name heuristic, add a per-project override in projects.json if it misfires
const PRE = /alpha|beta|(?<![a-z])(rc|pre|dev|test)|nightly|canary|experimental|-[0-9a-f]{7,}$/i;
const byVersionDesc = new Intl.Collator("en", { numeric: true }).compare;

function fromReleases(releases) {
  let stable = null, pre = null;
  // The API orders by tag/commit date, not publish date: a fix released later on an older
  // commit (1.7beta5 -> 1.7-beta5fix1) would lose. Newest published first.
  releases = releases.toSorted((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  for (const r of releases) {
    if (r.draft) continue;
    const v = { tag: r.tag_name, url: r.html_url, date: (r.published_at ?? "").slice(0, 10) };
    if (r.prerelease || PRE.test(r.tag_name)) pre ??= v;
    else stable ??= v;
  }
  // only show a pre-release that is newer than the stable one
  if (stable && pre && pre.date < stable.date) pre = null;
  return { stable, pre };
}

// No releases: read tags straight from git (no API quota). Tags carry no date here.
function fromTags(htmlUrl) {
  const out = execFileSync("git", ["ls-remote", "--tags", "--refs", `${htmlUrl}.git`], { encoding: "utf8" });
  const tags = out.split("\n").map(l => l.split("refs/tags/")[1]).filter(t => t && /\d/.test(t));
  tags.sort((a, b) => byVersionDesc(b, a));
  const v = t => t && { tag: t, url: `${htmlUrl}/releases/tag/${encodeURIComponent(t)}`, date: "" };
  const stable = v(tags.find(t => !PRE.test(t)));
  const pre = v(tags.find(t => PRE.test(t)));
  return { stable, pre: pre && (!stable || byVersionDesc(pre.tag, stable.tag) > 0) ? pre : null };
}

const readJson = async (f, fallback) => existsSync(f) ? JSON.parse(await readFile(f, "utf8")) : fallback;
const projects = await readJson("projects.json");
const previous = await readJson("data.json", []);
let offline = await readJson("offline.json", []);
const key = r => r.toLowerCase();
const out = [];
const dead = [];

// Offline repos that are reachable again go back to projects.json (and are processed below)
const revived = [];
for (const o of offline) {
  if (projects.some(p => key(p.repo) === key(o.repo))) continue; // re-added by hand
  if (!(await gh(`/repos/${o.repo}`))) continue;
  console.log(`back online: ${o.repo}`);
  revived.push(o.repo);
  projects.push({ repo: o.repo, ...(o.category && { category: o.category }) });
}

for (const p of projects) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(p.repo ?? "")) throw new Error(`invalid repo: ${JSON.stringify(p)}`);
  const repo = await gh(`/repos/${p.repo}`);
  if (!repo) { console.warn(`dead (404): ${p.repo}`); dead.push(p.repo); continue; }
  const releases = await gh(`/repos/${p.repo}/releases?per_page=30`);
  const { stable, pre } = releases?.length ? fromReleases(releases) : fromTags(repo.html_url);
  out.push({
    name: p.name ?? repo.name,
    url: repo.html_url,
    description: p.description ?? repo.description ?? "",
    category: p.category ?? "",
    stable,
    pre,
    updated: repo.pushed_at.slice(0, 10),
    stars: repo.stargazers_count,
    archived: repo.archived,
  });
  console.log(`${p.repo} -> ${stable?.tag ?? "-"} | ${pre?.tag ?? "-"}`);
}

await writeFile("data.json", JSON.stringify(out, null, 2) + "\n");

// A repo listed again in projects.json and alive is no longer offline
const alive = new Set(projects.filter(p => !dead.includes(p.repo)).map(p => key(p.repo)));
offline = offline.filter(o => !alive.has(key(o.repo)));

if (dead.length) {
  const today = new Date().toISOString().slice(0, 10);
  for (const r of dead) {
    const p = projects.find(p => p.repo === r);
    const last = previous.find(d => key(d.url) === key(`https://github.com/${r}`)) ?? {};
    offline.push({
      repo: r,
      name: p.name ?? last.name ?? r.split("/")[1],
      description: p.description ?? last.description ?? "",
      category: p.category ?? last.category ?? "",
      lastVersion: (last.stable ?? last.pre)?.tag ?? "",
      offlineSince: today,
    });
  }
}
if (dead.length || revived.length) {
  // One entry per line, same layout as the hand-edited file
  const kept = projects.filter(p => !dead.includes(p.repo));
  const w = Math.max(...kept.map(p => p.repo.length));
  const line = p => {
    const rest = Object.entries(p).filter(([k]) => k !== "repo").map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    return `  { "repo": ${JSON.stringify(p.repo)}` + (rest.length ? `,${" ".repeat(w - p.repo.length)} ${rest.join(", ")}` : "") + " }";
  };
  await writeFile("projects.json", "[\n" + kept.map(line).join(",\n") + "\n]\n");
}
await writeFile("offline.json", JSON.stringify(offline, null, 2) + "\n");
