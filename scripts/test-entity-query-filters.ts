import assert from "node:assert/strict";
import { filterIssues, filterPullRequests, queryWithDefaultOpen } from "../src/renderer/features/github-work/entity-query.js";
import type { IssueSummary, PullRequestSummary } from "../src/shared/domain/github-work.js";

const prBase: PullRequestSummary = {
  id: "pr-1",
  repoId: "repo",
  number: 12,
  title: "Improve sync filters",
  body: "@mona please review",
  authorLogin: "octo",
  assigneeLogins: ["hubot"],
  requestedReviewerLogins: ["mona"],
  state: "open",
  isDraft: false,
  merged: false,
  repoFullName: "octo/repo",
  headSha: "abc123",
  baseSha: "def456",
  baseBranch: "main",
  headBranch: "feature/filter",
  additions: 10,
  deletions: 2,
  changedFiles: 3,
  commitsCount: 2,
  commentsCount: 4,
  reviewCommentsCount: 1,
  reviewState: "approved",
  checkState: "passing",
  checkCount: 3,
  labels: ["priority", "backend"],
  htmlUrl: "https://github.com/octo/repo/pull/12",
  createdAt: "2026-01-12T12:00:00.000Z",
  updatedAt: "2026-01-13T12:00:00.000Z",
  closedAt: null,
  mergedAt: null,
  lastSyncedAt: "2026-01-13T12:00:00.000Z"
};

const issueBase: IssueSummary = {
  id: "issue-1",
  repoId: "repo",
  number: 8,
  title: "Fix priority bug",
  body: "cc @mona",
  authorLogin: "mona",
  assigneeLogins: ["octo"],
  state: "open",
  issueTypeName: "Bug",
  repoFullName: "octo/repo",
  commentsCount: 2,
  labels: ["bug", "P1"],
  htmlUrl: "https://github.com/octo/repo/issues/8",
  createdAt: "2026-01-10T12:00:00.000Z",
  updatedAt: "2026-01-14T12:00:00.000Z",
  closedAt: null,
  lastSyncedAt: "2026-01-14T12:00:00.000Z"
};

assert.equal(filterPullRequests([prBase], "review-requested:@me", "mona").length, 1);
assert.equal(filterPullRequests([prBase], "base:main head:feature status:passing review-state:approved commit-sha:abc", "mona").length, 1);
assert.equal(filterPullRequests([prBase], "created:1/12/26 comment-count:>=5", "mona").length, 1);
assert.equal(filterPullRequests([prBase], "start-date:1/12/26", "mona").length, 1);
assert.equal(filterPullRequests([prBase], "draft:false", "mona").length, 1);
assert.equal(filterPullRequests([prBase], "-label:backend", "mona").length, 0);
assert.equal(filterPullRequests([prBase], "label:backend -author:octo", "mona").length, 0);
assert.equal(filterPullRequests([prBase], "author:octo -label:nope", "mona").length, 1);
assert.equal(filterPullRequests([prBase], "-sync", "mona").length, 0);
assert.equal(filterPullRequests([prBase], "-draft:true", "mona").length, 1);
assert.equal(filterIssues([issueBase], "involves:@me mentions:@me updated:1/14/26 comment-count:2", "mona").length, 1);
assert.equal(filterIssues([issueBase], "start-date:1/10/26", "mona").length, 1);
assert.equal(filterIssues([issueBase], "priority:P1", "mona").length, 1);
assert.equal(filterIssues([issueBase], "type:Bug", "mona").length, 1);
assert.equal(filterIssues([issueBase], "type:Task", "mona").length, 0);
assert.equal(filterIssues([issueBase], "-priority:P1", "mona").length, 0);
assert.equal(filterIssues([issueBase], "-type:Bug", "mona").length, 0);
assert.equal(filterIssues([issueBase], "-start-date:1/10/26", "mona").length, 0);
assert.equal(queryWithDefaultOpen("sort:updated-desc"), "sort:updated-desc is:open");

console.log("Entity query filter tests ok");
