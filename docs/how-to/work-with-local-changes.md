# Work With Local Changes

The Local Changes view shows what has changed in a cloned repository on your machine.

Use it when you want to understand, save, commit, stash, or discard local work.

## Open Local Changes

1. Choose a cloned repository.
2. Open Local Changes.
3. Review the changed files list.

If a repository is metadata-only, it does not have local files for Fallback to inspect. Use a cloned repository when you need local Git features.

## Read The Changed Files List

The changed files list shows files that Git sees as modified, added, deleted, renamed, staged, untracked, or otherwise changed.

Select a file to inspect its diff or preview. For supported files, Fallback can also show file history or blame information.

## Stage And Unstage

Staging means choosing which changes will go into the next commit.

In Fallback, you can stage one file, unstage one file, stage all changes, or unstage all changes. This lets you build a commit carefully instead of committing every change at once.

## Commit Changes

Before committing, check:

- The selected files are the files you intend to commit.
- The commit author identity is correct for this repository.
- The commit message explains what changed and why.
- Any required checks or tests have been run outside Fallback.

Fallback records local Git operations so you have a clearer trail of what happened. Riskier actions follow the same safety pattern: state, risk, action, result, and recovery.

## Stash Changes

Stashing saves local changes without committing them. This is useful when you need to switch work, pull changes, or clear your working tree temporarily.

Fallback supports stashing all changes or selected files. You can later inspect, apply, pop, or drop stashes.

Apply keeps the stash after bringing the changes back. Pop brings the changes back and removes the stash if it succeeds.

## Discard Changes

Discarding removes local changes. This can be destructive.

Only discard a file when you are sure you no longer need the local edits. Fallback asks for confirmation around destructive actions, but it cannot recover every discarded change.

## Handle Conflicts

Pulling, switching branches, applying stashes, or merging can create conflicts. Fallback shows conflict state and can help open affected files or your merge tool.

When in doubt:

1. Read the conflict list.
2. Open each conflicted file.
3. Resolve the conflict in your editor.
4. Return to Fallback to confirm the state.

## Use Parallel Workspaces

Parallel Workspaces are Git worktrees presented as isolated lines of work. Use them for feature branches, hotfixes, experiments, review checkouts, or agent-produced changes.

Each workspace shows its branch, dirty state, last activity, local path, origin when Fallback can infer it, and cleanup safety. Clean parallel workspaces can usually be removed safely. Dirty, locked, missing, or prunable workspaces should be inspected before cleanup.
