# Offline Work

Fallback is built for the moments when GitHub or your network is not dependable. Think airplanes, train rides, hotel Wi-Fi, tethered connections, tunnels, travel days, conference networks, and ordinary afternoons when the internet keeps dropping.

Offline work does not mean every action is possible without the internet. It means you do not have to stop working just because GitHub cannot be reached. Fallback keeps useful context readable and protects work you create while GitHub cannot receive it.

## What Works Offline

When the needed data has already been synced, you can keep working without an internet connection. You can still read:

- Watched repositories.
- Pull requests and issues.
- Comments and review conversations.
- Checks and workflow history.
- Cached search results.
- Local files and local Git state for cloned repositories.
- Operation history and diagnostics already stored locally.

The exact amount available depends on what Fallback synced before you went offline.

## What Needs GitHub

These actions need GitHub or the network:

- First-time sync.
- Refreshing repository data.
- Posting comments to GitHub.
- Submitting pull request reviews to GitHub.
- Fetching, pulling, pushing, or publishing through a remote.
- Opening GitHub in a browser.

If GitHub cannot be reached, Fallback may show cached data or queue supported writebacks.

## Queued Writebacks

A queued writeback is a comment or review saved locally because it could not be sent to GitHub yet.

Fallback supports queueing:

- Issue comments.
- Pull request timeline comments.
- Pull request reviews.

You can open the queue, review the pending item, edit it if allowed, retry it, or cancel it before it is sent.

## When Queueing Happens

Fallback may queue a writeback when:

- Your computer is offline.
- GitHub is down or degraded.
- A specific GitHub surface, such as comments or pull requests, is unavailable.
- GitHub rate limits the request.
- A network error prevents delivery.

If GitHub rejects the action for a reason Fallback cannot fix automatically, the item may become blocked. For example, your token may have expired, repository access may have changed, or the pull request may no longer accept that review.

## A Safe Offline Habit

Before traveling or working somewhere unreliable, open Fallback and refresh the repositories you expect to need. That gives the local cache the best possible snapshot before the network gets worse.

This is the airplane mode: sync before you leave, keep reading and reviewing while disconnected, and let Fallback send supported queued comments or reviews when you are back online.
