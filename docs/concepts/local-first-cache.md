# Local-First GitHub Context

Fallback is local-first. That means it keeps useful GitHub context on your computer instead of making you depend on a live GitHub request for every screen.

## Why Local-First Matters

Code already works this way. When you clone a Git repository, you have a local copy of the code and history.

GitHub context usually does not work that way. Pull request conversations, issue threads, checks, and workflow runs often live only in GitHub. If GitHub is slow, down, or hard to search, that context can disappear from your working day.

Fallback closes that gap by keeping a local cache of the GitHub context you choose to sync.

## What The Cache Is

The cache is a local database inside your Fallback workspace. It stores synced information for watched repositories.

Depending on the repository and sync state, this can include:

- Repository details.
- Pull requests and issues.
- Comments and review discussions.
- Review state and review drafts.
- Labels, authors, assignees, and timestamps.
- Checks, statuses, and workflow runs.
- Search rows for faster local lookup.
- Health and sync records.
- Operation records for user-triggered actions.

The cache helps Fallback answer questions quickly: what needs review, which checks failed, what changed in a pull request, or where a past decision was discussed.

## Cached Does Not Mean Uploaded

Fallback is not sending your private repository context to a Fallback server. The cache lives on your machine.

Some actions still contact GitHub:

- Syncing a repository.
- Refreshing a pull request or issue.
- Posting a comment.
- Submitting a pull request review.
- Opening GitHub in your browser.

Those actions use your connected GitHub account.

## Fresh, Stale, And Offline

Cached information can have different states:

- Fresh means Fallback recently synced the repository successfully.
- Stale means Fallback has data, but it may be older than usual.
- Offline means Fallback cannot currently reach the network or GitHub, so it is showing cached data.
- Failed, rate limited, or auth error means Fallback tried to sync but GitHub or credentials blocked the update.

Even when a sync fails, older cached data can still be useful. Fallback tries to keep the last known context readable instead of showing a blank page.

## Deleting Cache Data

You can delete local data from Settings. Fallback supports deleting one repository's cache or deleting all local data.

Deleting cache data removes Fallback's local copy. It does not delete the GitHub repository, GitHub pull requests, GitHub issues, or comments that already exist on GitHub.

For repositories managed as local clone folders, be careful with delete options that mention local folders. Read the confirmation text before continuing.
