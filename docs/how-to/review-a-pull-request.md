# Review A Pull Request

Fallback helps you read pull request context, inspect the diff, and leave a review without losing your place.

## Open The Pull Request

1. Open Fallback.
2. Choose the repository.
3. Open Pull requests.
4. Select the pull request you want to review.

You can also use the command palette to search for the pull request by title, number, author, or repository.

## Read The Conversation

Start with the conversation. Look for:

- What the pull request is trying to change.
- Comments from reviewers.
- Requested changes.
- New commits since the last review.
- Failed or pending checks.

Fallback shows cached context, so refresh the pull request if you need the newest GitHub state before making a decision.

## Inspect The Diff

Open the diff view to see changed files. Use it to understand what changed and where review comments should go.

If the pull request is large, review the files in passes:

1. Skim filenames to understand the shape of the change.
2. Read the risky or central files first.
3. Check tests or supporting files.
4. Return to the conversation before submitting the review.

## Save Your Review Draft

Fallback keeps pull request review drafts locally. This helps when a review takes more than one sitting or when the network is unstable.

A local draft is not the same as a submitted GitHub review. It stays on your machine until you submit it.

## Submit A Review

When you are ready, choose the review outcome:

- Comment when you want to leave notes without approving or requesting changes.
- Approve when the pull request is ready from your point of view.
- Request changes when something must be fixed before merge.

Fallback sends the review to GitHub using your connected account.

## If GitHub Is Unavailable

If Fallback cannot send the review because you are offline or GitHub is unavailable, the review can be queued locally. You can inspect the queued item, retry it later, or cancel it before delivery.

When the relevant GitHub service is healthy again, Fallback can send queued writebacks.

## After Review

After submitting, refresh the pull request if you want to confirm the review appears on GitHub. You can also open the pull request on GitHub from Fallback.
