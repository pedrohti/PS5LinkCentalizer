# PS5 Links

Link hub for the PS5 jailbreak scene.

## Add a project

1. Edit [`projects.json`](projects.json) (you can do it right on GitHub with the ✏️ button).
2. Add a line:
   ```json
   { "repo": "owner/repository", "category": "Payload" }
   ```
   Optional fields: `name` and `description` (override the GitHub ones), `category`.
3. Open a Pull Request. A bot checks it (valid JSON, `owner/name` format, known fields, duplicates, repo exists) and replies in a comment with what to fix; the comment updates on every push.

Don't edit `data.json` or `offline.json`, they are generated automatically.

## How it works

- `.github/workflows/update.yml` runs every 3h (and when `projects.json` changes), fetches the latest stable version and the latest beta/pre-release (if newer) of each repo, and commits `data.json`.
- Pre-release = flagged as such on GitHub **or** tag containing `alpha`, `beta`, `rc`, `nightly`, `dev`, `pre`, `test`, `experimental`, or a trailing commit hash.
- Repos without releases: uses tags (`git ls-remote`), sorted by version.
- Dead repos (404): the PR check flags them. On the scheduled run they are moved from `projects.json` to `offline.json`, keeping their last known info, and listed on `offline.html`. Every run also re-checks `offline.json`: a repo that is reachable again goes back to `projects.json` with its category.
- Local: `node scripts/update.mjs` (Node 20+). Set `GITHUB_TOKEN` to avoid the 60 req/h limit.

## Disclaimer

PS5LinkCentalizer is only a link index. Its sole purpose is to make PS5 scene projects easier to find by gathering them in one place.

- The maintainers of this repository are **not affiliated** with, and do not develop, endorse, host, or distribute, any of the listed projects. All projects belong to their respective authors.
- Listed projects are provided by third parties **as is**. We make no guarantees about their safety, legality, or fitness for any purpose, and we are **not responsible** for any damage, data loss, banned accounts, bricked consoles, or other consequences of using them.
- Using homebrew or jailbreak software may violate the terms of service of your console or account and the laws of your jurisdiction. You use any listed project entirely at your own risk.
- If you are the author of a listed project and want it removed, open an issue.

## AI usage

This hub was built with the help of AI (Claude Code). I used it to speed up production and because I'm not very familiar with GitHub Actions and the GitHub API. All code was reviewed and is maintained by me; issues and PRs with improvements are welcome.

## License

[MIT](LICENSE)
