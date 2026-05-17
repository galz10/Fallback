# Fallback Context

Fallback is a local-first GitHub companion for watching repositories, reviewing GitHub work, inspecting local changes, and performing carefully recorded Git operations.

## Domain Language

- Watched repo: a GitHub repository the user has added to Fallback. It may have only cached GitHub metadata, or it may also have a local working tree.
- Local cache: the persisted copy of GitHub metadata, health probes, search rows, review drafts, and local bookkeeping that keeps the app useful while offline or rate limited.
- Repo identity: the per-repository Git author identity Fallback expects before local commits are created.
- Local Git operation: an operation-shaped local Git workflow that owns the Operation record, Recovery record policy, redacted command summary, result metadata, and app events for a user-triggered local Git change.
- Operation record: the audit trail for a user-triggered action, especially actions that mutate local Git state or remote GitHub work.
- Recovery record: the preflight snapshot metadata attached to risky operations so the app can explain what changed and how to recover.
- Credential diagnostics: checks that explain whether the active GitHub account, token, and repository access are healthy enough for the requested workflow.
- GitHub work: issues, pull requests, comments, reviews, checks, workflow runs, and related metadata synchronized from GitHub.
- Sync job: a scheduled or manual unit of GitHub synchronization with priority, cooldown, context, and cache freshness semantics.
- Repo sync pipeline: the ordered repo-level stages inside a Sync job, including repository metadata, local clone or fetch work, GitHub work hydration, cache warming, search indexing, Attention derivation, Branch Integrity follow-up, and health recording.
- Renderer freshness: the renderer's query invalidation intents after repository work, local changes, workspace switches, or GitHub work updates.
- Repo group: a user-defined grouping of watched repositories for filtering and focus.

## Architecture Principles

- Product concepts should be visible in filesystem boundaries before implementation details.
- Electron privilege boundaries should stay explicit: main owns OS, filesystem, Git, and database access; preload exposes a typed contract; renderer consumes only that contract.
- Risky local Git workflows should have high locality. Risk level, recovery snapshots, safety refs, command summaries, and operation result metadata belong together.
- Shared code should stay pure enough to run in tests and renderer code without pulling in Electron or Node-only APIs.
