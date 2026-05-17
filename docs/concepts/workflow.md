# Workflow

Fallback is designed around a simple loop: choose the repositories you care about, sync their context, start from My Work, understand the local or GitHub state, and act when you are ready.

## The Everyday Loop

1. Open Fallback.
2. Check My Work for Needs me, Waiting, At risk, Snoozed, Muted, or Done items.
3. Open a repository, pull request, issue, or check.
4. Read the cached context.
5. Refresh if you need the newest version from GitHub.
6. Review, comment, inspect local changes, or open the repository in your editor.
7. Let Fallback record the outcome of local Git actions and GitHub writebacks, including recovery hints.

You do not need to use every view. Most people will spend time in My Work, Pull requests, Issues, Code, and Local Changes.

## My Work

My Work brings attention items together. It is meant to answer three questions: why is this here, what changed, and what can I do next?

Fallback looks for signals like review requests, direct mentions, failing checks, stale saved review drafts, blocked writebacks, items assigned to you, and conversations where you are already involved. It can also quiet noisy bot activity and passing CI so important human work is easier to see.

## Repository Work

Inside a repository, the main workflow is split by job:

- Code for files, README, commits, branches, and repository controls.
- Pull requests for review conversations and diffs.
- Issues for planning and support conversations.
- Actions for checks and workflow runs.
- Local Changes for files changed on your machine.
- Branch Watch for suspicious branch changes.
- Parallel Workspaces for isolated local lines of work.

This keeps each view focused. You can move between them with the sidebar or command palette.

## Reading Before Acting

Fallback leans toward visible context before mutation. For risky local Git actions, the repeated pattern is state, risk, action, result, and recovery.

That is why you will see operation records, recovery information, conflict warnings, and confirmation dialogs around riskier actions.

## Working With GitHub Outages

When GitHub is unavailable, Fallback keeps showing cached data where it can. Supported comments and pull request reviews can be queued locally instead of being lost. Review drafts are saved as local work with GitHub sync attached, so restarting the app or losing the network should not erase your review.

This is useful anywhere internet is weak or unavailable: on airplanes, while traveling, during outages, or on networks that connect and disconnect every few minutes. You can keep reading, searching, reviewing, and organizing your next action instead of waiting for GitHub to load.

When connectivity or GitHub service health recovers, queued writebacks can be retried.

## Working With Local Code

For cloned repositories, Fallback can show your local branch, local changes, stashes, and commit history. It can also hand the repository off to your editor or terminal.

Fallback does not try to hide Git. It tries to make the important state easier to see before you make a Git change.
