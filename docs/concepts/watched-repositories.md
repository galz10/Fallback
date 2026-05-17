# Watched Repositories

A watched repository is a GitHub repository Fallback follows for you.

Watching a repository tells Fallback, "Keep this repository's context ready for me." It does not automatically change anything on GitHub.

## What Happens When You Watch A Repository

Fallback records the repository in your local workspace and starts syncing useful GitHub context. After the first sync, the repository appears in the app's main navigation and search surfaces.

Fallback can watch public or private repositories, as long as your connected GitHub account has access.

## Metadata-Only Repositories

Metadata-only repositories do not need a local code folder.

Use metadata-only mode when you mainly want to:

- Read issues and pull requests.
- Search conversations.
- Follow checks and workflow runs.
- Keep context available while offline.
- Track a repository you do not actively edit.

This mode is lighter because Fallback stores GitHub context without managing a local clone.

## Cloned Repositories

Cloned repositories have a local folder. This gives Fallback more to work with.

Use cloned mode when you want to:

- Browse files.
- Inspect commit history.
- Switch branches.
- View local changes.
- Stage, commit, stash, discard, pull, push, or publish work.
- Open the repository in your editor or terminal.

Cloned mode is best for repositories where you do hands-on development.

## Repository Groups

Repository groups let you organize watched repositories. Groups are useful if you work across several products, teams, clients, or areas of responsibility.

A group does not change the repository itself. It only helps you filter and focus inside Fallback.

## Unwatching A Repository

Unwatching removes the repository from Fallback's watched list. Depending on the action you choose, local cached data or managed local folders may also be removed.

Unwatching does not delete the GitHub repository.

## A Good Starting Setup

If you are setting up Fallback for the first time:

1. Add the repositories you personally review or change most often.
2. Use cloned mode for your main working repositories.
3. Use metadata-only mode for repositories you only need to follow.
4. Create groups if the list starts feeling busy.
