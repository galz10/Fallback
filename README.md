# Fallback

Fallback keeps GitHub work, local changes, and branch state coherent when repo work gets messy.

Git is distributed. GitHub context, review work, operation history, and branch safety evidence usually are not. Fallback keeps PRs, issues, reviews, comments, checks, local Git state, and recovery context available locally so you can keep working when GitHub, the network, or a branch history cannot be trusted to stay clean and current.

## Documentation

Start with the [Fallback docs](docs/README.md) for setup, core concepts, everyday workflows, reference pages, and troubleshooting written for non-technical readers.

## What Fallback Is

Fallback is a local-first GitHub workbench for professional repository work. You choose repos to watch, Fallback syncs the GitHub context you need day to day, and the desktop app keeps that context searchable, reviewable, actionable, and tied to local Git operation records.

## Why It Exists

GitHub owns a lot of working memory: review threads, issue decisions, check status, old PR context, and the evidence behind branch changes. Local Git owns a different kind of risk: dirty worktrees, branch divergence, destructive cleanup, and conflict recovery. Fallback gives both kinds of memory a local home so outages, flaky travel Wi-Fi, rate limits, slow GitHub search, and messy repo state do not stop you from understanding what happened or what to do next.

## Features

- Watch public or private GitHub repos after connecting GitHub.
- Cache PRs, issues, reviews, comments, labels, checks, and commit statuses locally.
- Start from My Work lanes for Needs me, Waiting, At risk, Snoozed, Muted, and Done work.
- Search cached repo context offline.
- Save PR review drafts locally, resume them after restart or offline work, and queue supported reviews or comments for retry.
- Inspect local Git preflights, operation records, recovery hints, conflicts, stashes, and branch state before mutating a repository.
- Use Branch Watch to explain suspicious branch changes in plain language with evidence and recovery paths.
- Use Parallel Workspaces to keep separate lines of work isolated, visible, and easier to clean up safely.
- Inspect repo, sync, and GitHub health states.
- Delete per-repo cache or all local cache data.
- Export redacted diagnostics by default, with an explicit opt-in for repo details.

## Status

Fallback is moving from private beta prototype toward production release readiness. The canonical development toolchain is Node 24.x with pnpm 10.33.x, pinned by `package.json`, `.node-version`, and `.nvmrc`. The production release matrix includes macOS arm64, Windows x64, and Linux x64 artifacts, with platform-specific signing or smoke validation in the release workflow.

Apple Developer ID signing and notarization are configured for macOS release tags. Windows releases require configured Authenticode signing through Azure Trusted Signing or a certificate fallback, and Linux releases ship with AppImage/deb smoke coverage. Auto-update is intentionally disabled for the first production release; users install explicit GitHub Release artifacts until an update channel is selected. GitHub write-back actions are intentionally supported for comments and PR reviews, using user-confirmed actions and operation records. SQLCipher remains deferred.

## Install

Internal unsigned macOS development build:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm package:mac:unsigned
```

The `.dmg` is written to `release/`. Unsigned builds are for local/internal testing only.

Signed and notarized macOS release build:

```bash
pnpm package:mac
```

`pnpm package:mac:release` is an alias for the same production command. The release build requires `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`.

Developer directory build:

```bash
pnpm package
```

Windows and Linux release builds:

```bash
pnpm package:win
pnpm package:linux
```

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

`better-sqlite3` and `keytar` are native. `pnpm test` runs a Node-runtime native ABI check before the test suite, `pnpm dev` rebuilds for Electron, and `pnpm native:clean` is the clean rebuild escape hatch.

Dependency installs are intentionally conservative. Direct dependencies are exact-pinned, pnpm and npm enforce a 14-day package release cooldown, pnpm blocks unreviewed lifecycle scripts unless the package is listed in `pnpm-workspace.yaml`, and CI uses frozen lockfile installs. Avoid `npx` for ad-hoc tools; add reviewed tools to `devDependencies` and run them with `pnpm exec` so execution goes through the lockfile.

Useful checks:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm format
pnpm build
pnpm beta:check
```

Sync one repo with a GitHub token:

```bash
GITHUB_TOKEN=ghp_example pnpm sync:repo owner/repo
```

Search cached data:

```bash
pnpm cache:search "query"
```

## Privacy

Your GitHub repo context is cached locally on your machine by default. Fallback does not upload your private PRs, issues, comments, or diffs to our servers. When you submit a PR review or post a PR or issue comment, that content is sent directly to GitHub using your connected account.

By default, Fallback stores its workspace at `~/Fallback` with the SQLite database at `~/Fallback/.fallback/fallback.sqlite`. The local cache is not encrypted by Fallback in the first production release; it relies on macOS account security and FileVault for at-rest protection. Users handling regulated or highly sensitive repositories should enable FileVault and follow their organization’s endpoint policy before caching private repo metadata.

GitHub tokens are stored in OS secure storage through Keychain or the host keychain provider. The GitHub OAuth flow requests repository access so Fallback can sync private repo context and perform user-initiated comment and review write-back. Diagnostics exports are redacted by default and exclude repo names, org names, workspace paths, database paths, titles, bodies, comments, diffs, and check logs. The Settings screen has a separate confirmation-gated export when repo details are needed for support.

## Troubleshooting

- If GitHub connection fails, disconnect and reconnect from Settings, then rerun a manual sync.
- If native modules fail after dependency changes, run `pnpm rebuild:electron` for the app, `pnpm rebuild:node` for CLI scripts, or `pnpm native:clean` for a clean native rebuild.
- If cached data looks stale, run a repo refresh from the app or `GITHUB_TOKEN=... pnpm sync:repo owner/repo`.
- If the app state is corrupted during beta testing, use Settings -> Delete all local data.
- If packaging fails on macOS signing, use `pnpm package:mac:unsigned` for internal unsigned builds while debugging certificate setup.
