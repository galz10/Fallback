import assert from "node:assert/strict";
import {
  attentionForIssue,
  attentionForPullRequest,
  sortAttentionItems,
  type AttentionEventSummary,
  type AttentionLocalState
} from "../src/shared/attention.js";
import type { IssueSummary, PullRequestSummary } from "../src/shared/domain/github-work.js";

const now = "2026-05-05T12:00:00.000Z";

const reviewRequest = attentionForPullRequest(
  pr({ id: "review", requestedReviewerLogins: ["mona"], updatedAt: "2026-05-05T11:50:00.000Z" }),
  { login: "mona", now }
);
assert.equal(reviewRequest.lane, "needs_me");
assert.equal(reviewRequest.reason, "explicit_review_request");
assert.equal(reviewRequest.actionable, true);
assert.equal(reviewRequest.suggestedAction, "Review");
assert.equal(reviewRequest.urgency, "high");
assert.deepEqual(reviewRequest.surfaces, ["my_work"]);

const staleReviewRequest = attentionForPullRequest(
  pr({ id: "stale-review", requestedReviewerLogins: ["mona"], updatedAt: "2026-05-03T11:50:00.000Z" }),
  { login: "mona", now }
);
assert.equal(staleReviewRequest.blocking, true);

const failingOwnPr = attentionForPullRequest(
  pr({ id: "failing", authorLogin: "mona", checkState: "failing", updatedAt: "2026-05-05T11:45:00.000Z" }),
  { login: "mona", now }
);
assert.equal(failingOwnPr.lane, "at_risk");
assert.equal(failingOwnPr.reason, "checks_failing");
assert.equal(failingOwnPr.blocking, true);
assert.equal(failingOwnPr.urgency, "critical");
assert.deepEqual(failingOwnPr.surfaces, ["my_work"]);

const mentionEvent: AttentionEventSummary = {
  id: "comment:1",
  kind: "comment",
  label: "Sarah commented",
  preview: "@mona can you confirm this path?",
  actorLogin: "sarah",
  actorIsBot: false,
  createdAt: "2026-05-05T11:55:00.000Z"
};
const directMention = attentionForIssue(issue({ body: "@mona can you look?", updatedAt: mentionEvent.createdAt }), {
  login: "mona",
  now,
  latestEvent: mentionEvent
});
assert.equal(directMention.lane, "needs_me");
assert.equal(directMention.reason, "direct_mention");
assert.deepEqual(directMention.surfaces, ["my_work"]);
assert.equal(directMention.whatChanged, "Sarah commented");
assert.equal(directMention.suggestedAction, "Reply");

const humanReply = attentionForPullRequest(pr({ id: "reply", authorLogin: "mona", updatedAt: "2026-05-05T11:56:00.000Z" }), {
  login: "mona",
  now,
  latestEvent: { ...mentionEvent, preview: "I left a follow-up question." }
});
assert.equal(humanReply.lane, "needs_me");
assert.equal(humanReply.reason, "human_reply");

const ownWaitingPr = attentionForPullRequest(pr({ id: "waiting", authorLogin: "mona", updatedAt: "2026-05-05T10:56:00.000Z" }), {
  login: "mona",
  now
});
assert.equal(ownWaitingPr.lane, "waiting");
assert.equal(ownWaitingPr.whyRelevant, "Your PR is waiting on review");
assert.equal(ownWaitingPr.urgency, "normal");
assert.deepEqual(ownWaitingPr.surfaces, ["my_work"]);

const staleReviewDraft = attentionForPullRequest(pr({ id: "review-draft", updatedAt: "2026-05-05T11:20:00.000Z" }), {
  login: "mona",
  now,
  reviewDraft: { commentCount: 2, reviewedFileCount: 5, updatedAt: "2026-05-05T11:40:00.000Z", outdated: true }
});
assert.equal(staleReviewDraft.lane, "at_risk");
assert.equal(staleReviewDraft.reason, "review_draft_pending");
assert.equal(staleReviewDraft.suggestedAction, "Resume");

const closedOwnPr = attentionForPullRequest(
  pr({ id: "closed", authorLogin: "mona", state: "closed", checkState: "failing", closedAt: "2026-05-05T11:15:00.000Z" }),
  {
    login: "mona",
    now
  }
);
assert.equal(closedOwnPr.lane, "watching");
assert.equal(closedOwnPr.actionable, false);
assert.deepEqual(closedOwnPr.surfaces, []);

const mergedOwnPr = attentionForPullRequest(
  pr({
    id: "merged",
    authorLogin: "mona",
    state: "closed",
    merged: true,
    reviewState: "changes requested",
    closedAt: "2026-05-05T11:15:00.000Z",
    mergedAt: "2026-05-05T11:15:00.000Z"
  }),
  {
    login: "mona",
    now
  }
);
assert.equal(mergedOwnPr.lane, "watching");
assert.equal(mergedOwnPr.whyRelevant, "PR already merged");
assert.deepEqual(mergedOwnPr.surfaces, []);

const assigned = attentionForIssue(issue({ assigneeLogins: ["mona"] }), { login: "mona", now });
assert.equal(assigned.lane, "needs_me");
assert.equal(assigned.reason, "assigned_to_you");
assert.deepEqual(assigned.surfaces, ["my_work"]);

const closedAssignedIssue = attentionForIssue(issue({ state: "closed", assigneeLogins: ["mona"], closedAt: "2026-05-05T11:15:00.000Z" }), {
  login: "mona",
  now
});
assert.equal(closedAssignedIssue.whyRelevant, "Issue already closed");
assert.deepEqual(closedAssignedIssue.surfaces, []);

const botOnly = attentionForPullRequest(pr({ id: "bot", authorLogin: "dependabot[bot]", updatedAt: "2026-05-05T11:58:00.000Z" }), {
  login: "mona",
  now
});
assert.equal(botOnly.lane, "noise");
assert.deepEqual(botOnly.surfaces, ["notifications"]);

const doneState: AttentionLocalState = {
  entityType: "pull_request",
  repoId: "octo-repo",
  entityNumber: 1,
  accountLogin: "mona",
  lastSeenEventId: null,
  lastSeenAt: null,
  readAt: null,
  doneAt: "2026-05-05T11:00:00.000Z",
  snoozedUntil: null,
  mutedUntil: null,
  pinnedAt: null,
  manualPriority: null
};
const doneResurrected = attentionForPullRequest(pr({ id: "done", body: "@mona human update", updatedAt: mentionEvent.createdAt }), {
  login: "mona",
  now,
  latestEvent: mentionEvent,
  localState: doneState
});
assert.equal(doneResurrected.lane, "needs_me");
assert.equal(doneResurrected.doneAt, null);

const snoozed = attentionForPullRequest(pr({ id: "snoozed", requestedReviewerLogins: ["mona"] }), {
  login: "mona",
  now,
  localState: { ...doneState, doneAt: null, snoozedUntil: "2026-05-05T18:00:00.000Z" }
});
assert.equal(snoozed.lane, "snoozed");
assert.equal(snoozed.actionable, false);

const sorted = sortAttentionItems([botOnly, failingOwnPr, reviewRequest]);
assert.equal(sorted[0]?.id, failingOwnPr.id);
assert.equal(sorted[1]?.id, reviewRequest.id);

console.log("Attention classifier tests ok");

function pr(patch: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    id: patch.id ?? "pr",
    repoId: patch.repoId ?? "octo-repo",
    repoFullName: patch.repoFullName ?? "octo/repo",
    number: patch.number ?? 1,
    title: patch.title ?? "Improve attention routing",
    body: patch.body ?? null,
    authorLogin: patch.authorLogin ?? "sarah",
    assigneeLogins: patch.assigneeLogins ?? [],
    requestedReviewerLogins: patch.requestedReviewerLogins ?? [],
    state: patch.state ?? "open",
    isDraft: patch.isDraft ?? false,
    merged: patch.merged ?? false,
    baseBranch: "main",
    headBranch: "feature",
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    additions: 12,
    deletions: 3,
    changedFiles: 2,
    commentsCount: 1,
    reviewCommentsCount: 0,
    reviewState: patch.reviewState ?? null,
    commitsCount: 1,
    checkState: patch.checkState ?? "unknown",
    checkCount: 0,
    htmlUrl: "https://github.com/octo/repo/pull/1",
    labels: patch.labels ?? [],
    createdAt: patch.createdAt ?? "2026-05-05T10:00:00.000Z",
    updatedAt: patch.updatedAt ?? "2026-05-05T11:00:00.000Z",
    closedAt: patch.closedAt ?? null,
    mergedAt: patch.mergedAt ?? null,
    lastSyncedAt: patch.lastSyncedAt ?? now
  };
}

function issue(patch: Partial<IssueSummary> = {}): IssueSummary {
  return {
    id: patch.id ?? "issue",
    repoId: patch.repoId ?? "octo-repo",
    repoFullName: patch.repoFullName ?? "octo/repo",
    number: patch.number ?? 2,
    title: patch.title ?? "Clarify notification empty state",
    body: patch.body ?? null,
    authorLogin: patch.authorLogin ?? "sarah",
    assigneeLogins: patch.assigneeLogins ?? [],
    state: patch.state ?? "open",
    commentsCount: 1,
    htmlUrl: "https://github.com/octo/repo/issues/2",
    labels: patch.labels ?? [],
    createdAt: patch.createdAt ?? "2026-05-05T10:00:00.000Z",
    updatedAt: patch.updatedAt ?? "2026-05-05T11:00:00.000Z",
    closedAt: patch.closedAt ?? null,
    lastSyncedAt: patch.lastSyncedAt ?? now
  };
}
