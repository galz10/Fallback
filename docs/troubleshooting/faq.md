# FAQ

## Is Fallback A GitHub Replacement?

No. Fallback is a companion for GitHub. It keeps important GitHub context local, searchable, and easier to work with, especially when GitHub is slow or unavailable.

## Does Fallback Upload My Repository Context?

No. Fallback's cache is local to your machine.

Fallback sends data to GitHub when you sync or when you choose to post a comment, submit a review, fetch, pull, push, or publish.

## Can I Use Fallback Offline?

Yes, for data that has already been synced. You can read cached pull requests, issues, comments, checks, and local repository state while offline.

That includes practical no-internet situations like airplanes, travel days, unreliable Wi-Fi, tethered connections, and outages. Sync before you go, then keep reading, reviewing, and preparing work from the local cache.

Some actions still need the network, such as first-time sync, refresh, fetch, pull, push, and posting to GitHub.

## What Is A Watched Repository?

A watched repository is a repository Fallback tracks for you. Watching lets Fallback sync GitHub context and show the repository in the app.

## What Is Metadata-Only Mode?

Metadata-only mode syncs GitHub context without requiring a local code folder. It is good for repositories you read, review, or monitor but do not actively edit.

## What Is Cloned Mode?

Cloned mode gives Fallback a local repository folder. It is needed for code browsing, local changes, stashes, branches, commits, fetch, pull, push, and publish features.

## Where Is My Data Stored?

By default, Fallback stores its workspace at:

```text
~/Fallback
```

The local SQLite database lives inside that workspace.

## Is The Local Cache Encrypted?

Fallback does not encrypt its SQLite cache in the first production release. Use operating system disk encryption before caching private or sensitive repository context.

## What Happens If GitHub Is Down?

Fallback keeps showing cached data where it can. Supported comments and pull request reviews can be queued locally and sent later when GitHub is reachable again.

## Does Unwatching Delete The GitHub Repository?

No. Unwatching only removes the repository from Fallback. It does not delete the repository on GitHub.

Read the confirmation text carefully if local cache data or managed local folders are involved.
