import assert from "node:assert/strict";
import type { PullRequestSummary } from "../src/shared/domain/github-work.js";
import {
  authoredMyPullRequests,
  filterMyPullRequests,
  myPullRequestStatusCounts
} from "../src/renderer/features/github-work/my-pull-requests.js";

const basePr: PullRequestSummary = {
  id: "base",
  repoId: "repo",
  number: 1,
  title: "Base PR",
  body: null,
  authorLogin: "octocat",
  assigneeLogins: [],
  requestedReviewerLogins: [],
  state: "open",
  isDraft: false,
  merged: false,
  repoFullName: "octo/repo",
  headSha: "head",
  baseSha: "base",
  baseBranch: "main",
  headBranch: "feature",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  commitsCount: 1,
  commentsCount: 0,
  reviewCommentsCount: 0,
  reviewState: null,
  checkState: "unknown",
  checkCount: 0,
  labels: [],
  htmlUrl: "https://github.com/octo/repo/pull/1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  closedAt: null,
  mergedAt: null,
  lastSyncedAt: "2026-01-02T00:00:00Z"
};

const prs: PullRequestSummary[] = [
  pr({ id: "created", number: 2, authorLogin: "mona", updatedAt: "2026-01-05T00:00:00Z" }),
  pr({ id: "assigned", number: 3, assigneeLogins: ["mona"], updatedAt: "2026-01-04T00:00:00Z" }),
  pr({ id: "review", number: 4, requestedReviewerLogins: ["MONA"], updatedAt: "2026-01-06T00:00:00Z" }),
  pr({ id: "mentioned", number: 5, body: "cc @mona", updatedAt: "2026-01-03T00:00:00Z" }),
  pr({ id: "draft", number: 8, authorLogin: "mona", isDraft: true, updatedAt: "2026-01-06T12:00:00Z" }),
  pr({
    id: "closed",
    number: 6,
    authorLogin: "mona",
    state: "closed",
    updatedAt: "2026-01-07T00:00:00Z",
    closedAt: "2026-01-07T00:00:00Z"
  }),
  pr({
    id: "merged",
    number: 7,
    authorLogin: "mona",
    state: "closed",
    merged: true,
    updatedAt: "2026-01-08T00:00:00Z",
    mergedAt: "2026-01-08T00:00:00Z"
  })
];

const authored = authoredMyPullRequests(prs, "mona");
const activeMine = filterMyPullRequests(prs, "mona", "");
const closedMine = filterMyPullRequests(prs, "mona", "is:closed");
const allMine = filterMyPullRequests(prs, "mona", "is:all");
const repoQualifiedMine = filterMyPullRequests(prs, "mona", "repo:octo/repo type:pr");
const counts = myPullRequestStatusCounts(authored);

assert.deepEqual(
  activeMine.map((item) => item.number),
  [8, 2]
);
assert.deepEqual(
  closedMine.map((item) => item.number),
  [6]
);
assert.deepEqual(
  allMine.map((item) => item.number),
  [6, 8, 2]
);
assert.deepEqual(
  repoQualifiedMine.map((item) => item.number),
  [8, 2]
);
assert.equal(counts.open, 1);
assert.equal(counts.draft, 1);
assert.equal(counts.closed, 1);

console.log("My PRs section tests ok");

function pr(overrides: Partial<PullRequestSummary>): PullRequestSummary {
  return { ...basePr, ...overrides };
}
