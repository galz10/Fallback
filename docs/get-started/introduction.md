# Introduction

Fallback keeps GitHub work, local changes, and branch state coherent when repo work gets messy. It helps you keep working when GitHub is slow, unavailable, rate limited, or simply too full of context to search quickly.

Git already gives every repository a local copy of the code. GitHub context is different. Pull request discussions, issue decisions, review comments, checks, and workflow results usually live only in GitHub. When that context is hard to reach, work slows down.

Fallback gives that context a local home and connects it to the local Git state you are about to change.

## What Fallback Does

Fallback connects to your GitHub account, watches the repositories you choose, and keeps useful GitHub information cached on your computer. You can then open the app to read, search, and inspect work even when your network is unreliable or completely unavailable.

Fallback is built for day-to-day repository work:

- See the repositories you care about.
- Read pull requests, issues, comments, reviews, labels, checks, and workflow runs.
- Search cached GitHub context from the desktop app.
- Start from My Work lanes for work that needs you, work waiting on others, risky states, snoozed work, muted threads, and completed items.
- Review pull request diffs.
- Save pull request review drafts locally, resume them later, and see whether the PR head changed since the draft started.
- Write issue comments, pull request comments, and pull request reviews.
- Queue supported comments and reviews when GitHub is unavailable, then send them later.
- Inspect local code, local changes, branches, commits, stashes, operation records, and recovery hints for repositories with a local folder.
- Use Branch Watch to inspect suspicious branch changes in plain language.
- Use Parallel Workspaces to isolate feature work, hotfixes, experiments, reviews, and agent-produced changes.
- Open a repository in your editor, terminal, Finder, or GitHub.
- Export diagnostics for support, with sensitive details redacted by default.

## What Fallback Is Not

Fallback is not a replacement for GitHub or a generic Git client. It focuses on the parts of repository work that get expensive when context, local changes, or branch history become hard to trust: knowing what needs attention, reading context, preserving review work, safely handling local changes, and recovering with evidence.

Fallback is also not a cloud sync service. Your cached repository context stays on your machine unless you choose to send a comment, submit a review, open GitHub, or share diagnostics.

## When Fallback Helps

Fallback is useful when:

- GitHub is down or degraded.
- You are on flaky Wi-Fi.
- You are on a plane, train, or somewhere with no dependable internet.
- GitHub search is slow or incomplete.
- You need to remember what happened in an old issue or pull request.
- You work across several repositories and want one place to see what needs attention.
- You want local Git operations to leave a clear record of what happened.
- You need to understand branch safety warnings without reading tree SHAs first.
- You keep separate lines of work in worktrees and want them presented as parallel workspaces with cleanup safety.

## The Basic Idea

You choose repositories to watch. Fallback syncs their GitHub context into a local cache. From there, you can browse and search that context quickly.

Some repositories can be metadata-only. That means Fallback tracks GitHub information but does not need a local code folder.

Other repositories can have a local folder. For those, Fallback can also show files, branches, commits, local changes, stashes, and local Git actions.

## Where To Start

If this is your first time using Fallback, read these next:

1. [Install](install.md)
2. [Your first repository](first-repository.md)
3. [Workflow](../concepts/workflow.md)
