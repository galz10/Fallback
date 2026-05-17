# Fallback Video Questions And Answers

## Essential

### 1. Logo

Available in this folder:

- `assets/fallback-logo-light.png` - high-res light logo, 1254 x 1254.
- `assets/fallback-logo-dark.png` - high-res dark logo, 1254 x 1254.
- `assets/fallback-mark-light.png` - high-res light mark, 720 x 720.
- `assets/fallback-mark-dark.png` - high-res dark mark, 720 x 720.

Source assets were copied from `src/renderer/assets/`. No SVG logo was found in the repository.

Animation direction: trace the connected node paths of the Fallback mark first, then pop in the final node. The mark already reads like a branch graph, so the reveal can feel like a commit graph being drawn.

### 2. One-liner

Recommended:

> GitHub context, saved where you work.

More explicit:

> A local home for the GitHub context your repo work depends on.

Punchier:

> Keep working when GitHub is having a moment.

### 3. Color Palette

Fallback uses a dark, precise developer-tool palette based on the app tokens.

- Background: `#000000` / near-black.
- Surface: `#0a0a0a`, `#111111`, `#1a1a1a`.
- Borders: white alpha, roughly `rgba(255,255,255,0.08)` to `rgba(255,255,255,0.24)`.
- Primary text: near-white, roughly `#ededed`.
- Muted text: neutral gray, roughly `#8f8f8f`.
- Success / clean: green family from the app tokens, especially `hsl(131 43% 57%)`.
- Warning / branch risk: amber `#f5a623`.
- Danger: red `#ff0000` / `hsl(358 75% 59%)`.
- GitHub work accents: purple for PRs, green for issues, blue for sync/cache status.

Visual recommendation: keep most scenes black or off-black, with white logo lines and restrained green, amber, red, blue, and purple state accents. Avoid a bright marketing gradient.

### 4. Product Name And Version

Use `Fallback`.

The package version in `package.json` is `0.1.0`, but the video should not lead with that. Suggested on-screen treatment:

> Fallback

Optional small sublabel:

> Public alpha

## Scene Content

### 5. Key Features List

Recommended hero features:

1. Watched repositories: pick repos, sync GitHub context locally, and keep PRs/issues/checks searchable.
2. My Work: a cross-repo attention queue for reviews, mentions, failing checks, stale drafts, blocked sends, snoozed work, and muted threads.
3. Pull Request Review: review conversations, files, and diffs with GitHub context kept close.
4. Local Changes: inspect diffs, stage, stash, commit, manage conflicts, and preserve operation records before risky Git work.
5. Command Palette and Status: move quickly through repo actions and see GitHub health/uptime signals.
6. Branch Watch: suspicious branch changes explained with landed, expected, tested, and recovery evidence. This is still a strong message, but the current manual footage only includes still references for it.

### 6. Integration Logos

Use only integrations that are true to Fallback:

- GitHub - primary service integration for repos, PRs, issues, reviews, comments, checks, and workflow runs.
- Git - core local repository engine.
- macOS Finder - open local folders.
- Terminal - open repo in terminal.
- Editor / IDE - open local repo or file in configured editor.
- OS keychain - token storage through secure storage.

Optional ecosystem chips, framed as local workflow surfaces rather than direct integrations:

- GitHub Actions.
- Local editor.
- Local terminal.
- Local working tree.

Avoid implying integrations with AI agents, Notion, Slack, Telegram, or other apps unless product support is added.

### 7. Demo Screenshots Or Screen Recordings

Primary manual demos recorded from the local Electron app:

- `demos/raw/watch-repo.mp4` - watched repositories, local cache, repo health, repo search.
- `demos/raw/work-queue.mp4` - My Work lanes, requested reviews, mentions, lower-priority grouping.
- `demos/raw/pull-request-flow.mp4` - PR activity/conversation, changed files, diff review.
- `demos/raw/local-changes.mp4` - Local Changes, repo context, changed file, inline red/green diff.
- `demos/raw/command-palette-github-status.mp4` - command palette navigation into GitHub Status.

Primary hero PNGs:

- `demos/raw/watch-hero.png` - Repositories hero still.
- `demos/raw/my-work-hero.png` - My Work hero still.
- `demos/raw/pr-review-hero.png` - PR review / code diff hero still.
- `demos/raw/local-changes-hero.png` - Local Changes hero still.
- `demos/raw/branch-watch-hero.png` - Branch Watch evidence hero still.

### 8. Target Users

Primary users:

- Staff engineers keeping several repos and reviews straight.
- Maintainers who need branch safety, PR history, and recovery evidence.
- Engineering leads who need a cross-repo picture of risk and attention.
- Developers working while traveling, offline, rate limited, or in complex local Git state.

Suggested role chips:

- Maintainer.
- Reviewer.
- Release lead.
- Staff engineer.

Avoid made-up names or agent avatars. Fallback does not currently have AI integrations, so the video should not imply agents are product users or collaborators.

## Nice To Have

### 9. Demo Video Of Product In Action

Provided in `demos/raw/` as five manually recorded MP4 screen recordings captured from the local app.

### 10. Font Name

App CSS uses:

- Primary: Geist.
- Fallback: Inter, system UI, Apple system fonts.
- Mono: Geist Mono, JetBrains Mono, system monospace.

Recommended video typography: Geist for UI and overlay text, Geist Mono for commands, hashes, paths, and operation evidence.

### 11. Taglines And Overlay Copy

Recommended overlays:

- GitHub context, saved where you work.
- Keep working when GitHub is having a moment.
- PRs, issues, checks, and review drafts close to your repo.
- Reviews, issues, checks, and local changes in one workbench.
- Review GitHub work without losing the thread.
- Suspicious branch changes, explained with evidence.
- Risky Git work gets a recovery trail.
- Fast navigation. Clear health signals.
- Work offline. Send when ready.
- Read context locally. Act when you are ready.
- Built for repo work that needs proof before action.

### 12. CTA

Website or download URL was not present in the repository docs.

Recommended placeholder until confirmed:

> Try the Fallback public alpha.

Secondary:

> Available for macOS, Windows, and Linux.

If a URL is confirmed later, use:

> Try the public alpha at fallback.sh

or replace with the actual canonical URL.

### 13. Audio / Music

No audio track was provided.

Recommended audio direction: restrained, precise, low-gloss electronic bed. Use soft ticks or clicks for branch graph drawing, sync pulses, and evidence card reveals. Keep it quieter than typical launch-video music so the product feels operational and trustworthy.
