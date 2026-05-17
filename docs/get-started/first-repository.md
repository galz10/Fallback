# Your First Repository

A watched repository is a repository Fallback keeps track of for you. Once a repository is watched, Fallback can sync its GitHub context and show it in the app.

## Add A Repository

1. Open Fallback.
2. Connect GitHub if you have not already.
3. Use the repository picker or command palette to find a repository.
4. Choose the repository you want to watch.
5. Wait for the first sync to finish.

You can search by repository name or paste a full `owner/name` repository name.

## Pick A Watch Mode

Fallback can work with a repository in two ways.

Metadata-only means Fallback syncs GitHub context, such as issues, pull requests, comments, checks, and workflow runs. This is enough for reading, searching, and reviewing GitHub work.

Cloned means Fallback also has a local folder for the repository. This unlocks code browsing, branch switching, commit history, local changes, stashes, fetch, pull, push, and publish actions.

If you are unsure, start with the default cloned mode for repositories you actively change, and metadata-only for repositories you only need to follow.

## Read The First Sync

During sync, Fallback gathers the repository information it needs. You may see a syncing state, then a fresh state when the cache is up to date.

If GitHub is unavailable, rate limited, or your token does not have access, the repository may show a warning. Fallback keeps any older cached data it already has, so you can still read what was previously synced.

## Open The Main Views

Once the repository is watched, try these views:

- Code: files, README, branches, commits, and local repository controls.
- Pull requests: cached pull requests, conversations, review state, and diffs.
- Issues: cached issues and conversations.
- Actions: checks and workflow runs.
- Local Changes: changed files, diffs, stashes, commits, conflict information, and operation recovery records.
- Branch Watch: suspicious branch changes with plain-language evidence and recovery paths.
- Parallel Workspaces: separate local workspaces for feature work, hotfixes, experiments, reviews, or agent-produced changes.

If a view needs a local folder and the repository is metadata-only, Fallback will show what it can and guide you toward the missing local setup.

## Search From The Command Palette

The command palette is the fastest way to move around Fallback.

Use it to:

- Open a repository.
- Search cached pull requests and issues.
- Search files and commits.
- Jump to a view.
- Open a repository in your editor, terminal, Finder, or GitHub.
- Run common sync and local Git actions.

See [Command palette and shortcuts](../reference/command-palette.md) for the default shortcuts.

## Know What Is Local

Fallback keeps a local cache. That means a page may show information that was synced earlier rather than information pulled from GitHub this second.

When you need the newest data, refresh the repository. When you are offline, on spotty internet, or working from a plane, use the cached data as a readable snapshot of what Fallback last saw. The point is that a bad connection should not stop you from reading context, preparing a review, or understanding what happened.
