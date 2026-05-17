# Privacy And Security

Fallback is local-first. It is designed to keep GitHub context on your machine, not on a Fallback server.

## What Stays Local

Fallback stores synced repository context in your local workspace. This may include:

- Repository names and metadata.
- Pull request and issue titles.
- Pull request and issue bodies.
- Comments and review text.
- Labels, authors, assignees, and timestamps.
- Checks and workflow information.
- Search index data.
- Review drafts.
- Queued writebacks.
- Operation and recovery records.

This data stays on your computer unless you choose an action that sends data elsewhere.

## What Gets Sent To GitHub

Fallback contacts GitHub when it needs to sync or when you choose to write something.

Examples include:

- Syncing watched repositories.
- Refreshing a pull request or issue.
- Posting an issue comment.
- Posting a pull request comment.
- Submitting a pull request review.
- Fetching, pulling, pushing, or publishing through a Git remote.

These actions use your connected GitHub account and GitHub permissions.

## GitHub Credentials

Fallback stores GitHub tokens in operating system secure storage, such as Keychain on macOS or the host keychain provider on other systems.

If your GitHub account, organization SSO, or repository permissions change, you may need to reconnect GitHub.

## Local Cache Encryption

Fallback does not encrypt its SQLite cache in the first production release.

If you work with private, regulated, or sensitive repositories, enable disk encryption before syncing them. On macOS, use FileVault. On managed devices, follow your organization's endpoint security policy.

## Diagnostics

Fallback can export diagnostics to help with support.

Diagnostics are redacted by default. The default export avoids including repo names, organization names, workspace paths, database paths, titles, bodies, comments, diffs, and check logs.

If support needs repository-specific details, Fallback requires a separate confirmation before exporting them.

## Deleting Data

You can delete local cache data in Settings.

Deleting local cache data does not delete GitHub repositories, pull requests, issues, comments, or reviews on GitHub. It only removes Fallback's local copy.

Read destructive confirmations carefully, especially for settings that mention managed local clone folders.
