# Settings

Settings controls how Fallback connects, syncs, stores data, and hands work to other tools.

## GitHub Account

Connect or disconnect your GitHub account here.

Fallback uses the connected account to:

- List repositories you can access.
- Sync watched repository context.
- Post comments you choose to send.
- Submit pull request reviews you choose to submit.

If repository access changes, reconnecting GitHub can refresh credentials and permissions.

## Workspace

The workspace is where Fallback stores local app data. By default, this is `~/Fallback`.

The workspace can include:

- The local SQLite cache.
- Synced repository metadata.
- Review drafts.
- Queued writebacks.
- Managed local clone folders.
- Operation and recovery records.

Settings can reveal the current workspace in Finder or the file browser.

## Repository Defaults

Repository defaults control what happens when you watch a new repository.

Common options include:

- Whether new repositories are metadata-only or cloned by default.
- Whether Fallback should create local folders for watched repositories.
- Whether Fallback should open a repository folder after adding it.

Choose cloned defaults if you mostly work on code locally. Choose metadata-only defaults if you mainly read and review.

## Sync Frequency

Sync frequency controls how often Fallback refreshes watched repository context in the background.

Shorter intervals feel fresher but create more GitHub traffic. Longer intervals are quieter and may be better if you watch many repositories or often hit rate limits.

You can still refresh manually when you need the latest state.

## Editor And Terminal

Fallback can hand a cloned repository to your editor or terminal.

If you leave these blank, Fallback uses system defaults where possible. If your setup needs a specific command, add it here.

Examples might include an editor command or a terminal command that accepts a working directory.

## Restore Windows

When restore windows is enabled, Fallback tries to reopen the repository and workspace windows you were using last time.

This is useful if you often work in several repositories at once.

## Attention Settings

Attention settings influence what My Work promotes or quiets.

You can control whether Fallback should:

- Collapse bot activity.
- Promote failing checks.
- Promote direct mentions.
- Promote review requests.
- Quiet passing CI.
- Use working hours for attention behavior.

These settings help My Work stay useful instead of noisy.

## Command Shortcuts

Command shortcut settings control the keyboard shortcuts used by the command palette and common navigation actions.

See [Command palette and shortcuts](command-palette.md) for the default bindings.

## Branch Watch

Branch Watch settings control branch audit behavior.

You can choose whether Branch Watch is enabled, whether safety refs are fetched, whether audits run after sync, and what severity should trigger alerts.

## Cache And Diagnostics

Cache settings let you inspect storage usage, delete repository cache data, delete all local data, or export diagnostics.

Diagnostics are redacted by default. A separate confirmation is required when support needs repository-specific details.
