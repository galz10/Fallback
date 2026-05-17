import assert from "node:assert/strict";
import {
  filterIssuesByPreset,
  filterPullRequestsByPreset,
  issuePresetCounts,
  pullRequestPresetCounts,
  sortIssuesForTriage,
  sortPullRequestsForTriage,
  triageIssue,
  triagePullRequest
} from "../src/shared/triage.js";
import type { IssueSummary, PullRequestSummary } from "../src/shared/domain/github-work.js";

const now = new Date().toISOString();
const old = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();

const prs = [
  pr({ id: "review", number: 1, requestedReviewerLogins: ["mona"], updatedAt: now }),
  pr({ id: "checks", number: 2, checkState: "failing", checkCount: 3, updatedAt: now }),
  pr({ id: "stale", number: 3, updatedAt: old }),
  pr({ id: "merged", number: 4, state: "closed", merged: true, mergedAt: now, updatedAt: now })
];

assert.equal(triagePullRequest(prs[0]!, "mona").reviewSignal, "needs_review");
assert.equal(triagePullRequest(prs[1]!, "mona").attentionReason, "Checks failing");
assert.deepEqual(
  filterPullRequestsByPreset(prs, "needs_my_review", "mona").map((item) => item.id),
  ["review"]
);
assert.deepEqual(
  filterPullRequestsByPreset(prs, "failed_checks", "mona").map((item) => item.id),
  ["checks"]
);
assert.deepEqual(
  filterPullRequestsByPreset(prs, "merged_recently", "mona").map((item) => item.id),
  ["merged"]
);
assert.equal(pullRequestPresetCounts(prs, ["needs_my_review", "failed_checks"], "mona").failed_checks, 1);
assert.equal(sortPullRequestsForTriage(prs, "mona")[0]?.id, "review");

const issues = [
  issue({ id: "assigned", number: 10, assigneeLogins: ["mona"], updatedAt: now }),
  issue({ id: "mentioned", number: 11, body: "cc @mona", updatedAt: now }),
  issue({ id: "stale", number: 12, updatedAt: old }),
  issue({ id: "closed", number: 13, state: "closed", closedAt: now, updatedAt: now })
];

assert.equal(triageIssue(issues[0]!, "mona").attentionReason, "Assigned to you");
assert.deepEqual(
  filterIssuesByPreset(issues, "mentioning_me", "mona").map((item) => item.id),
  ["mentioned"]
);
assert.deepEqual(
  filterIssuesByPreset(issues, "stale_open", "mona").map((item) => item.id),
  ["stale"]
);
assert.equal(issuePresetCounts(issues, ["assigned_to_me", "closed_recently"], "mona").assigned_to_me, 1);
assert.equal(sortIssuesForTriage(issues, "mona")[0]?.id, "assigned");

console.log("Triage preset and sorting tests ok");

function pr(patch: Partial<PullRequestSummary> & Pick<PullRequestSummary, "id" | "number">): PullRequestSummary {
  return {
    id: patch.id,
    repoId: patch.repoId ?? "octo-repo",
    number: patch.number,
    title: patch.title ?? `PR ${patch.number}`,
    body: patch.body ?? null,
    authorLogin: patch.authorLogin ?? "octocat",
    assigneeLogins: patch.assigneeLogins ?? [],
    requestedReviewerLogins: patch.requestedReviewerLogins ?? [],
    state: patch.state ?? "open",
    isDraft: patch.isDraft ?? false,
    merged: patch.merged ?? false,
    repoFullName: patch.repoFullName ?? "octo/repo",
    headSha: patch.headSha ?? "head",
    baseSha: patch.baseSha ?? "base",
    baseBranch: patch.baseBranch ?? "main",
    headBranch: patch.headBranch ?? "feature",
    additions: patch.additions ?? null,
    deletions: patch.deletions ?? null,
    changedFiles: patch.changedFiles ?? null,
    commitsCount: patch.commitsCount ?? null,
    commentsCount: patch.commentsCount ?? 0,
    reviewCommentsCount: patch.reviewCommentsCount ?? 0,
    reviewState: patch.reviewState ?? null,
    checkState: patch.checkState ?? "unknown",
    checkCount: patch.checkCount ?? 0,
    labels: patch.labels ?? [],
    htmlUrl: patch.htmlUrl ?? null,
    createdAt: patch.createdAt ?? now,
    updatedAt: patch.updatedAt ?? now,
    closedAt: patch.closedAt ?? null,
    mergedAt: patch.mergedAt ?? null,
    lastSyncedAt: patch.lastSyncedAt ?? now
  };
}

function issue(patch: Partial<IssueSummary> & Pick<IssueSummary, "id" | "number">): IssueSummary {
  return {
    id: patch.id,
    repoId: patch.repoId ?? "octo-repo",
    number: patch.number,
    title: patch.title ?? `Issue ${patch.number}`,
    body: patch.body ?? null,
    authorLogin: patch.authorLogin ?? "octocat",
    assigneeLogins: patch.assigneeLogins ?? [],
    state: patch.state ?? "open",
    repoFullName: patch.repoFullName ?? "octo/repo",
    commentsCount: patch.commentsCount ?? 0,
    labels: patch.labels ?? [],
    htmlUrl: patch.htmlUrl ?? null,
    createdAt: patch.createdAt ?? now,
    updatedAt: patch.updatedAt ?? now,
    closedAt: patch.closedAt ?? null,
    lastSyncedAt: patch.lastSyncedAt ?? now
  };
}
