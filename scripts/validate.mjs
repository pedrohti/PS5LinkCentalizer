// Validates a projects.json (from a PR) and prints a Markdown report for the PR comment.
// Exit code 1 when there are errors; warnings don't fail the check.
// Usage: node scripts/validate.mjs <projects.json to check>   (set GITHUB_TOKEN for the API checks)
// Runs from the base branch and only reads the PR file as data: no PR code is executed.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const file = process.argv[2] ?? "projects.json";
const headers = { Accept: "application/vnd.github+json", "User-Agent": "ps5-link-centralizer" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const errors = [], warnings = [];
const FIELDS = ["repo", "name", "description", "category"];
const readJson = async (f, fallback) => existsSync(f) ? JSON.parse(await readFile(f, "utf8")) : fallback;

function report() {
  const out = [];
  if (!errors.length) out.push(`### ✅ \`projects.json\` looks good`);
  else out.push(`### ❌ \`projects.json\` has ${errors.length} problem${errors.length > 1 ? "s" : ""}`, "", ...errors.map(e => `- ${e}`));
  if (warnings.length) out.push("", "**Warnings** (won't block the PR, but please check):", "", ...warnings.map(w => `- ${w}`));
  out.push("", "<sub>See [Add a project](https://github.com/pedrohti/PS5LinkCentalizer#add-a-project). This comment updates on every push.</sub>");
  console.log(out.join("\n"));
  process.exit(errors.length ? 1 : 0);
}

// 1. Valid JSON, with the line/column of the mistake
const text = await readFile(file, "utf8");
let projects;
try {
  projects = JSON.parse(text);
} catch (e) {
  // Older Node reports "position N"; newer V8 only quotes ~10 chars before and after the bad token
  let pos = +(e.message.match(/position (\d+)/)?.[1] ?? NaN);
  const ctx = e.message.match(/"([\s\S]*?)"(?:\.\.\.)? is not valid JSON/)?.[1];
  if (Number.isNaN(pos) && ctx && text.indexOf(ctx) >= 0) pos = text.indexOf(ctx) + Math.min(10, text.indexOf(ctx), ctx.length - 1);
  const where = Number.isNaN(pos) ? "" : (() => {
    const before = text.slice(0, pos).split("\n");
    return ` at line ${before.length}, column ${before.at(-1).length + 1}`;
  })();
  const why = e.message.split(/, \.\.\.|, "| in JSON| is not valid JSON/)[0];
  errors.push(`Invalid JSON${where}: ${why}. Common causes: a missing or extra comma (no comma after the last entry), or a missing quote.`);
  report();
}
if (!Array.isArray(projects)) { errors.push("The file must be a JSON array: `[ { \"repo\": \"owner/name\" }, ... ]`."); report(); }

// 2. Each entry
const base = await readJson("projects.json", []); // base branch: known categories
const offline = await readJson("offline.json", []);
const categories = new Set(base.map(p => p.category).filter(Boolean));
const seen = new Map();
for (const [i, p] of projects.entries()) {
  const at = `Entry ${i + 1}${typeof p?.repo === "string" ? ` (\`${p.repo}\`)` : ""}`;
  if (typeof p !== "object" || p === null || Array.isArray(p)) { errors.push(`${at}: must be an object like \`{ "repo": "owner/name", "category": "Payload" }\`.`); continue; }
  for (const k of Object.keys(p)) if (!FIELDS.includes(k)) errors.push(`${at}: unknown field \`${k}\`. Allowed: ${FIELDS.map(f => `\`${f}\``).join(", ")}.`);
  for (const k of FIELDS.slice(1)) if (k in p && typeof p[k] !== "string") errors.push(`${at}: \`${k}\` must be a string.`);
  if (typeof p.repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(p.repo)) {
    errors.push(`${at}: \`repo\` must be \`owner/name\` (not a full URL), e.g. \`"repo": "itsPLK/ps5-payload-manager"\`.`);
    continue;
  }
  const k = p.repo.toLowerCase();
  if (seen.has(k)) errors.push(`${at}: duplicate, already listed as entry ${seen.get(k)}.`);
  else seen.set(k, i + 1);
  if (typeof p.category === "string" && p.category && categories.size && !categories.has(p.category))
    warnings.push(`${at}: new category \`${p.category}\`. Existing ones: ${[...categories].sort().map(c => `\`${c}\``).join(", ")}.`);
  if (offline.some(o => o.repo.toLowerCase() === k)) warnings.push(`${at}: listed as offline; it comes back automatically once it's reachable.`);
}

// 3. Repos must exist (only the ones added or changed by the PR, to save API calls)
const baseRepos = new Set(base.map(p => p.repo.toLowerCase()));
for (const [k, n] of seen) {
  if (baseRepos.has(k)) continue;
  const repo = projects[n - 1].repo;
  const res = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  if (res.status === 404) { errors.push(`Entry ${n} (\`${repo}\`): repository not found. Check the spelling, or it may be private or deleted.`); continue; }
  if (!res.ok) { warnings.push(`Entry ${n} (\`${repo}\`): couldn't check it (GitHub API ${res.status}).`); continue; }
  const r = await res.json();
  if (r.full_name.toLowerCase() !== k) warnings.push(`Entry ${n} (\`${repo}\`): the repository was renamed to \`${r.full_name}\`; please use the new name.`);
  if (r.archived) warnings.push(`Entry ${n} (\`${repo}\`): the repository is archived.`);
}
report();
