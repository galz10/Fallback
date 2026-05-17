# Offline GitHub Writeback Queue Plan

## Goal

Make GitHub writebacks resilient when the user is offline, GitHub is degraded, or a specific GitHub surface is failing. A user should be able to write issue comments, PR comments, and PR reviews exactly when they have the thought, see those sends collected in a clear queue, edit or delete them before delivery, and trust Fallback to send them automatically when the relevant service recovers.

This should feel native to Fallback: calm, dense, precise, keyboard-friendly, and visually aligned with the existing dark operational UI. The queue is not a marketing feature; it is a workbench safety feature.

## Current State

- Issue comments and normal PR comments immediately call GitHub `POST /issues/:number/comments`.
- PR review submissions immediately call GitHub `POST /pulls/:number/reviews`.
- PR diff reviews already have local saved drafts in `pr_review_drafts`, including inline comments and reviewed files.
- The UI blocks sending when `navigator.onLine` is false.
- Network/API failures leave operation records as failed.
- There is an `offline_actions` table in the baseline schema, but no store, IPC API, service, scheduler, or UI currently uses it.
- Health probes already distinguish `pull_requests`, `issues`, and `comments`, and global GitHub health can report `offline`, `github_down`, `github_degraded`, `rate_limited`, and `auth_error`.

## Product Behavior

### CUJ 1: User Is Offline

1. User writes an issue comment, PR comment, or PR review.
2. User presses the normal send/submit button.
3. If the app knows the user is offline, the action is saved to the queue instead of rejected.
4. The composer clears only after the queue write succeeds.
5. A toast or inline confirmation says the item was queued locally.
6. The queue indicator updates immediately.
7. User can open the queue, edit the body/payload, delete the item, or jump back to the issue/PR.
8. When the app comes back online, queued items are sent automatically.
9. Successfully sent items disappear from the active queue and remain briefly in a completed history or operation log.

### CUJ 2: GitHub PR Service Has an Issue

1. User writes a PR review or PR comment while the PR/comments surface is failing.
2. If health probes or recent write failures indicate PR/comment writeback is unavailable, the item is queued.
3. Fallback periodically checks GitHub health and retries eligible queued items with backoff.
4. Once the relevant surface is healthy, Fallback sends queued items automatically.
5. If GitHub rejects an item for non-transient reasons, it stays in the queue as `blocked` with direct recovery copy.

### CUJ 3: GitHub Issues Service Has an Issue

Same behavior as PRs, scoped to issue comments and the `issues`/`comments` health surfaces.

## Scope

### In Scope

- Queue issue comments.
- Queue PR timeline comments.
- Queue PR reviews with event, summary body, and inline comments.
- Queue status surfaces in the shell and entity detail pages.
- Edit, delete, retry now, and open source entity from queue UI.
- Automatic send on recovery.
- Periodic recovery checks.
- Durable local storage.
- Deduplication/idempotency safeguards.
- Tests for stores, service state machine, renderer logic, and failure classification.

### Out of Scope

- Offline editing of issue/PR titles, labels, assignees, branch operations, merges, or review requests.
- GitHub-native draft reviews.
- Multi-device queue sync.
- Conflict resolution that attempts to rewrite comments after PR diffs change beyond safe inline positioning.

## Terminology

- `Queued writeback`: a locally saved GitHub mutation that has not been successfully posted.
- `Surface`: a GitHub capability needed by an action, such as `issues`, `pull_requests`, or `comments`.
- `Transient failure`: offline, network timeout, GitHub 5xx, rate limit, GitHub degraded/down, local request budget exhaustion.
- `Permanent failure`: permission denied, SSO required, auth expired, repo access revoked, PR closed when review requires open PR, invalid inline review position.
- `Blocked`: a queued item that cannot be retried automatically until the user fixes something.

## Data Model

Use the existing `offline_actions` table as the starting point, but formalize it into a real domain. Add columns if needed through a migration rather than relying only on baseline schema.

Recommended table shape:

```sql
CREATE TABLE offline_actions (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  repo_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_number INTEGER NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_attempt_at TEXT,
  posted_at TEXT,
  last_error_code TEXT,
  last_error TEXT,
  upstream_last_seen_sha TEXT,
  upstream_last_seen_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Recommended status values:

- `queued`: waiting for connectivity/service recovery.
- `sending`: currently being posted.
- `failed_retryable`: failed recently, retry scheduled.
- `blocked`: needs user action.
- `sent`: posted successfully.
- `cancelled`: user deleted before send.

Recommended action types:

- `issue_comment`
- `pr_comment`
- `pr_review`

Payload examples:

```ts
type OfflineActionPayload =
  | {
      actionType: "issue_comment";
      body: string;
    }
  | {
      actionType: "pr_comment";
      body: string;
    }
  | {
      actionType: "pr_review";
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
      comments?: PullRequestReviewCommentInput[];
      headSha: string | null;
    };
```

Keep `body` duplicated as a plain text preview for list rendering and search. Treat `payload_json` as the source of truth for submission.

## Domain Layer

Add a shared domain file:

- `src/shared/domain/offline-action.ts`

Include:

- `OfflineAction`
- `OfflineActionStatus`
- `OfflineActionType`
- `CreateOfflineActionInput`
- `UpdateOfflineActionInput`
- `OfflineActionQueueSummary`
- `OfflineActionFailureKind`

Add helpers:

- `offlineActionTitle(action)`
- `offlineActionPreview(action)`
- `offlineActionCanEdit(action)`
- `offlineActionCanRetry(action)`
- `offlineActionRequiredSurfaces(action)`

## Store Layer

Add a local cache store:

- `electron/main/local-cache/offline-action-store.ts`

Responsibilities:

- create action
- list active actions by repo/account
- list active actions globally
- get action
- update editable fields
- mark sending
- mark sent
- mark retryable failure
- mark blocked
- cancel/delete
- count queued items
- find due actions
- recover stuck `sending` items on startup

Startup recovery rule:

- Any `sending` action older than 5 minutes becomes `failed_retryable`.
- Preserve `attempt_count`, `last_error`, and `next_attempt_at`.

Retention:

- Keep `sent` and `cancelled` actions for 7 days or the latest 100 rows, whichever is smaller.
- Active queue rows never expire.

## Writeback Service

Add a service:

- `electron/main/github-work/offline-writeback-queue.ts`

Responsibilities:

- decide whether to send now or enqueue
- enqueue action with enough entity context
- send due actions
- classify retryable vs blocked failures
- emit renderer events when queue changes
- schedule retry timers
- run periodic health checks

The existing `GitHubWorkWriteback` should remain the low-level live sender. The new service wraps it.

Proposed API:

```ts
class OfflineWritebackQueueService {
  submitIssueComment(input): Promise<WritebackSubmitResult>;
  submitPullRequestComment(input): Promise<WritebackSubmitResult>;
  submitPullRequestReview(input): Promise<WritebackSubmitResult>;
  enqueue(input): OfflineAction;
  list(input): OfflineAction[];
  update(id, input): OfflineAction;
  cancel(id): OfflineAction;
  retryNow(id): Promise<void>;
  flushDueActions(reason): Promise<void>;
}
```

`WritebackSubmitResult`:

```ts
type WritebackSubmitResult =
  | { mode: "sent" }
  | { mode: "queued"; action: OfflineAction; reason: "offline" | "github_unavailable" | "rate_limited" | "network_error" };
```

## Send Or Queue Decision

Queue immediately when:

- `navigator.onLine` state forwarded from renderer says offline.
- `health.offlineStatus()` returns `offline`, `github_down`, `github_degraded`, or `rate_limited`.
- Latest relevant surface probe is `offline`, `down`, `degraded`, or `rate_limited`.
- A live send throws a retryable error.

Send immediately when:

- user is connected
- repo/account is visible
- relevant health is okay or stale/unknown
- action payload validates

Important nuance:

- Do not trust `navigator.onLine` as the only source of truth.
- If UI says online but GitHub POST fails with a retryable error, enqueue the action instead of losing it.
- If UI says offline but the user presses send, enqueue without attempting POST.

## Relevant Surfaces

Map action types to surfaces:

- `issue_comment`: `issues`, `comments`, global `rest_api`
- `pr_comment`: `pull_requests`, `comments`, global `rest_api`
- `pr_review`: `pull_requests`, `comments`, global `rest_api`

Use repo probes when available. Fall back to global probes when repo probes are missing or stale.

Health freshness:

- Fresh: checked in the last 2 minutes.
- Stale: older than 2 minutes.
- Missing/stale health should not block a live send by itself.
- Missing/stale health can trigger an immediate background probe after queueing or failure.

## Retry Policy

Use exponential backoff with jitter:

- attempt 1: 15 seconds
- attempt 2: 45 seconds
- attempt 3: 2 minutes
- attempt 4: 5 minutes
- attempt 5+: 15 minutes
- max interval: 30 minutes

Retry immediately when:

- app starts
- network changes to online
- health probe changes a required surface to operational
- user clicks `Retry now`
- account reconnect succeeds

Stop automatic retry and mark `blocked` when:

- auth expired/revoked
- insufficient scope
- SSO required
- repo access revoked/404
- validation error from GitHub
- PR review inline positions are invalid
- PR is closed/merged and action cannot be applied
- action was created under a different GitHub account and the account is not active

Rate limit:

- Use GitHub rate limit reset when available for `next_attempt_at`.
- Show reset time in queue UI.

## Idempotency And Duplicate Prevention

GitHub comment APIs do not provide a strong idempotency key. Use local safeguards:

- Never retry an action marked `sending` unless startup recovery decides it is stale.
- Store `attempt_count`, `last_attempt_at`, and `posted_at`.
- After a network timeout where the POST result is unknown, refresh the entity comments/reviews before retrying.
- Compare likely duplicates authored by the active user:
  - same action type
  - same body
  - same entity
  - created within a small window after `last_attempt_at`
- If a likely duplicate is found, mark the action `sent` and link the fetched comment/review URL when possible.

Optional body marker:

- Do not append hidden markers to user comments by default. That leaks implementation detail into GitHub.
- If duplicate detection proves unreliable, consider a future opt-in metadata strategy, but avoid it in v1.

## PR Review Conflict Rules

For `pr_review`, store `headSha` in payload.

Before sending:

- Fetch or read cached current PR head SHA.
- If head SHA changed and the review contains inline comments, mark `blocked` with copy: "The PR changed since this review was queued. Open the review, refresh the diff, and confirm the inline comments."
- If head SHA changed and the review has only a summary body/event, allow send if PR is still open and not draft.
- If PR became draft, closed, or merged, mark blocked.

Editing a blocked PR review should let the user:

- remove invalid inline comments
- change event
- update summary
- discard action
- open current diff

## IPC And Preload Contract

Add IPC channels:

- `offlineActionsList`
- `offlineActionsGet`
- `offlineActionsUpdate`
- `offlineActionsCancel`
- `offlineActionsRetry`
- `offlineActionsFlush`
- `offlineActionsSummary`

Add event:

- `offline-actions-changed`

Expose through preload:

```ts
window.fallback.offlineActions = {
  list,
  get,
  update,
  cancel,
  retry,
  flush,
  summary,
  onChanged
};
```

Update contracts:

- `src/shared/contracts/fallback-api.ts`
- contract tests
- preload tests

## Integrating Existing Write Paths

Change the IPC handlers for:

- `prsAddComment`
- `prsSubmitReview`
- `issuesAddComment`

Current behavior:

- operation runner calls live sync/writeback directly.

Target behavior:

- operation runner calls queue-aware service.
- service returns `sent` or `queued`.
- operation record result summary should distinguish:
  - "Posted to GitHub."
  - "Queued locally. Fallback will send this when GitHub is reachable."

Avoid making queued actions look like failed operations.

## Renderer UX

### Queue Entry Points

Add a global queue indicator in the shell chrome near existing status/sync affordances:

- Compact button with count badge.
- Neutral state when empty.
- Amber/dim accent when queued.
- Red/error accent only when blocked.
- Tooltip: "GitHub send queue".

Add entity-local affordances:

- In issue detail and PR detail timelines, show a small queued row where the new comment would appear.
- In PR diff view, show queued review status in the review drawer after submit.
- In list views, optionally show a subtle queued badge for entities with pending local writebacks.

### Queue Panel

Use a right-side drawer or popover sheet, not a full page. It should feel like a command-center panel:

- Header: "GitHub send queue"
- Count summary: `3 queued`, `1 blocked`, `next retry in 42s`
- Segmented filter: `Active`, `Blocked`, `Sent`
- Rows grouped by repo, then entity.
- Each row is compact and information-dense.

Row anatomy:

- status dot
- action label: `Issue comment`, `PR comment`, `PR review`
- repo and entity: `octo/repo #123`
- body preview, two lines max
- age and retry status
- actions: edit, retry now, delete, open

Use icon buttons with accessible labels:

- edit: pencil
- retry: rotate/retry icon
- delete: trash
- open: external/open icon

Do not put every row in a heavy card. Prefer a list with subtle separators, hover background, and selected/focused state.

### Edit Flow

Editing should be inline or in a focused modal/drawer section:

- Body textarea for comments.
- For PR reviews:
  - event segmented control: `Approve`, `Comment`, `Request changes`
  - summary textarea
  - inline comments list with remove/edit affordances
  - warning if head SHA changed
- Save button.
- Delete button requires confirmation or undo.

Keyboard behavior:

- `Enter` opens selected row.
- `e` edits selected row when focused in list.
- `r` retries selected row.
- `Delete` prompts delete selected row.
- `Esc` closes edit mode/panel.

### Composer Behavior

When offline or GitHub is degraded:

- Keep the same primary send button.
- Button label can remain `Comment` / `Submit review`; the resulting state tells the truth.
- Inline status should say:
  - "Offline. Send will be queued."
  - "GitHub comments are degraded. Send will be queued."
  - "Rate limited. Send will be queued until reset."

After press:

- Clear composer.
- Show queued timeline ghost row.
- Show toast: "Queued locally. It will send when GitHub is reachable."

If queue save fails:

- Do not clear composer.
- Show error: "Could not save this locally. Keep this text open and try again."

### Visual Direction

Follow the existing Fallback dark UI:

- compact rows
- restrained borders
- small text and tabular metadata
- no marketing cards
- no gradient/orb decoration
- status uses small dots, badges, and clear copy
- destructive actions are quiet until invoked
- blocked state earns attention but does not flood the interface

Recommended tones:

- queued: amber text/dot on neutral surface
- sending: blue or neutral spinner
- sent: muted green, briefly visible
- blocked: red/amber depending on cause
- cancelled: muted

## Error Copy

Examples:

- Offline: "Queued locally. Fallback will send this when you're back online."
- GitHub degraded: "Queued locally. GitHub comments are unavailable right now."
- Rate limit: "Queued until GitHub rate limit resets at 2:14 PM."
- Auth expired: "Reconnect GitHub before this can send."
- SSO: "Approve organization SSO, then retry."
- PR changed: "The PR changed since this review was queued. Open the review and confirm inline comments."
- Permission: "This account cannot write to this repository."

## Service Recovery Loop

Add a lightweight scheduler:

1. On app startup:
   - recover stale `sending` actions
   - load active queue summary
   - flush due actions if online
2. On queue create:
   - schedule next due send
3. On `online` renderer event:
   - run global health probe
   - flush due actions
4. On health probe result:
   - if relevant surfaces recovered, flush due actions
5. Every 60 seconds while active queue exists:
   - run due retry check
   - optionally run health probe when blocked by service state

Avoid a busy loop. If no active queue exists, no queue timer should run.

## Interaction With Sync And Cache

After successful send:

- Upsert returned GitHub comment/review into local cache immediately.
- Invalidate renderer queries for the entity, repo list, and my-work lists.
- Trigger a targeted refresh:
  - issue: `syncIssue(repoId, issueNumber)`
  - PR comment/review: `syncPullRequest(repoId, prNumber)`

After blocked failure:

- Refresh entity state when useful, especially for PR head changes and closed/merged state.

## Security And Privacy

- Queue rows contain user-written comment bodies. They live in the same local cache as existing drafts.
- Never log full queued comment bodies in diagnostics.
- Operation records should include action type and entity, not body.
- Redact payload in diagnostic events.
- Scope list APIs to the active GitHub account and visible repos.
- If a user switches accounts, do not send actions created under a different account unless explicitly confirmed.

## Migrations

Add migration:

- Ensure `offline_actions` exists in migrated databases.
- Add missing columns from the target model.
- Add indexes:
  - `(status, next_attempt_at)`
  - `(repo_id, entity_type, entity_number)`
  - `(account_id, status)`
  - `(updated_at)`

Because the baseline schema already has `offline_actions`, migration should be additive and idempotent.

## Testing Plan

### Unit Tests

- store create/list/update/cancel/mark sent
- startup recovery from stale `sending`
- retry backoff calculation
- failure classification
- required surface mapping
- PR head SHA conflict classification
- duplicate detection after uncertain timeout

### Service Tests

- offline create queues without POST
- GitHub down queues after failed POST
- issue comments flush when issues/comments surface recovers
- PR reviews flush when PR/comments surface recovers
- rate limit schedules reset-based retry
- auth failure becomes blocked
- successful flush upserts comment/review and clears active queue
- cancelled action is never sent

### Renderer Tests

- composer says send will be queued while offline
- send clears composer only after local queue write succeeds
- queue panel lists active rows
- edit updates queued body/payload
- delete/cancel removes active row
- blocked row shows recovery copy
- count badge updates on event
- PR review drawer shows queued review confirmation

### Contract Tests

- preload exposes `offlineActions`
- IPC validates IDs, repo visibility, and payload shapes
- renderer event contract for `offline-actions-changed`

### Manual QA

- Turn off network, queue issue comment, reconnect, verify GitHub receives it.
- Turn off network, queue PR review with inline comments, reconnect, verify review posts.
- Simulate GitHub 503 for comments, queue both issue and PR comments, recover, verify flush.
- Simulate rate limit, verify next retry copy.
- Change PR head after queuing inline review, verify blocked state.
- Switch GitHub account with active queue, verify sends are blocked.
- Restart app with queued and sending rows, verify recovery.

## Implementation Phases

### Phase 1: Durable Queue Core

- Add shared offline action domain types.
- Add migration/indexes.
- Add `OfflineActionStore`.
- Add tests for store and migrations.
- Add startup recovery for stale `sending` rows.

Deliverable:

- Queue can persist, list, edit, cancel, and mark actions without any UI.

### Phase 2: Queue-Aware Writeback

- Add queue service wrapping existing GitHub writeback.
- Integrate issue comment, PR comment, and PR review IPC handlers.
- Implement retry classification and backoff.
- Upsert sent results into GitHub cache.
- Emit queue changed events.
- Add service tests.

Deliverable:

- Sending while offline or GitHub is down creates queue entries; flushing posts them.

### Phase 3: Recovery Scheduler

- Run startup flush.
- Listen for online state from renderer.
- Use existing health probes to decide recovery.
- Add periodic retry loop only when active queue exists.
- Add rate limit reset scheduling.

Deliverable:

- Queue sends automatically when connectivity or service health recovers.

### Phase 4: Shell Queue UI

- Add shell queue indicator.
- Add queue drawer/panel.
- Add filters, grouped rows, edit/delete/retry/open actions.
- Add accessible labels and keyboard handling.
- Add blocked/sent/queued visual states.

Deliverable:

- User can inspect, edit, delete, and retry queued actions from a polished queue surface.

### Phase 5: Composer And Entity Integration

- Update issue/PR composers to queue on send instead of blocking offline.
- Update PR review drawer submit behavior.
- Add queued ghost rows in timelines/details.
- Add entity badges where useful.
- Add toast/inline confirmations.

Deliverable:

- The primary comment/review workflow feels seamless offline and during GitHub outages.

### Phase 6: Hardening

- Add duplicate detection after uncertain POST failures.
- Add PR head SHA conflict blocking.
- Add account-switch safeguards.
- Add retention cleanup.
- Add manual QA scripts/mocks for GitHub 503 and offline.

Deliverable:

- Queue is safe enough for normal daily use without accidental duplicate posts.

## Acceptance Criteria

- Pressing send while offline queues issue comments, PR comments, and PR reviews.
- Pressing send while relevant GitHub service is degraded queues the action.
- Queued actions are visible from a global shell indicator.
- User can edit and delete queued actions before send.
- User can retry queued actions manually.
- Queue flushes automatically after network/service recovery.
- Successful sends clear from active queue and update local cached entity state.
- Blocked actions stay visible with specific recovery copy.
- PR inline review comments do not auto-send against a changed head SHA.
- No full comment bodies are written to diagnostic logs.
- Tests cover store, service, contracts, and renderer behavior.

## Open Decisions

- Whether sent items should appear in a short `Sent` history inside the queue drawer or only in operation history.
- Whether queued issue/PR comments should appear as timeline ghost rows by default or only in the queue drawer.
- Whether to allow manual "send anyway" when health says degraded but live POST might work.
- How much keyboard shortcut surface to ship in v1 versus adding after the queue UI stabilizes.

## Suggested First PR

Start with Phase 1 and a thin slice of Phase 2:

- domain types
- migration
- store
- service enqueue/list/cancel
- IPC contract
- tests

Do not touch the composer UI in the first PR. Once the queue is durable and tested, wire one action type end to end, preferably issue comments, then generalize to PR comments and reviews.
