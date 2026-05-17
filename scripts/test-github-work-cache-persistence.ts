import assert from "node:assert/strict";
import {
  persistGitHubWorkToCache,
  persistIssueRelationsToCache,
  persistPullRequestRelationsToCache,
  persistUserPullRequestToCache,
  type GitHubWorkCachePersistencePort
} from "../electron/main/sync/github-work-cache-persistence.js";
import type { GitHubIssue, GitHubLabel, GitHubPullRequest } from "../electron/main/github-client.js";

const calls: string[] = [];
const runtime: GitHubWorkCachePersistencePort = {
  pullRequestNeedsCacheRefresh: (_repoId, pr) => pr.number === 1,
  issueNeedsCacheRefresh: (_repoId, issue) => issue.number === 2 || Boolean(issue.pull_request),
  transaction: (work) => {
    calls.push("transaction:start");
    work();
    calls.push("transaction:end");
  },
  upsertLabel: (_repoId, label) => calls.push(`label:${label.name}`),
  upsertPullRequest: (_repoId, pr) => calls.push(`pr:${pr.number}`),
  upsertIssue: (_repoId, issue) => calls.push(`issue:${issue.number}`),
  upsertEntityLabels: (_repoId, entityType, number, labels) =>
    calls.push(`entity-labels:${entityType}:${number}:${labels.map((label) => label.name).join(",")}`)
};

const bug = { name: "bug" } as GitHubLabel;
const docs = { name: "docs" } as GitHubLabel;
const result = persistGitHubWorkToCache(runtime, {
  repoId: "octo-repo",
  labels: [bug, docs],
  pullRequests: [
    { number: 1, labels: [bug] },
    { number: 3, labels: [docs] }
  ] as GitHubPullRequest[],
  issues: [
    { number: 2, labels: [docs] },
    { number: 1, pull_request: {}, labels: [bug] }
  ] as GitHubIssue[]
});

assert.equal(result.changedPullRequestCount, 1);
assert.equal(result.changedIssueCount, 1);
assert.equal(result.pullRequestRefreshByNumber.get(1), true);
assert.equal(result.pullRequestRefreshByNumber.get(3), false);
assert.deepEqual(calls, [
  "transaction:start",
  "label:bug",
  "label:docs",
  "pr:1",
  "entity-labels:pull_request:1:bug",
  "issue:2",
  "entity-labels:issue:2:docs",
  "issue:1",
  "entity-labels:pull_request:1:bug",
  "transaction:end"
]);

const userPrChanged = persistUserPullRequestToCache(
  {
    ...runtime,
    recordUserPullRequest: (login, repoId, prNumber, relation) => calls.push(`user-pr:${login}:${repoId}:${prNumber}:${relation}`)
  },
  { repoId: "octo-repo", login: "mona", pullRequest: { number: 1, labels: [bug] } as GitHubPullRequest, relation: "author" }
);
assert.equal(userPrChanged, true);
assert.ok(calls.includes("user-pr:mona:octo-repo:1:author"));

persistIssueRelationsToCache(
  {
    transaction: runtime.transaction,
    upsertIssue: runtime.upsertIssue,
    upsertEntityLabels: runtime.upsertEntityLabels,
    upsertComment: (_repoId, entityType, number, comment) => calls.push(`comment:${entityType}:${number}:${comment.id}`)
  },
  { repoId: "octo-repo", issue: { number: 4, labels: [docs] } as GitHubIssue, comments: [{ id: 11 }] as never }
);
assert.ok(calls.includes("comment:issue:4:11"));

persistPullRequestRelationsToCache(
  {
    transaction: runtime.transaction,
    upsertPullRequest: runtime.upsertPullRequest,
    upsertEntityLabels: runtime.upsertEntityLabels,
    upsertComment: (_repoId, entityType, number, comment) => calls.push(`comment:${entityType}:${number}:${comment.id}`),
    upsertReview: (_repoId, number, review) => calls.push(`review:${number}:${review.id}`),
    upsertCheckRun: (_repoId, number, sha, checkRun) => calls.push(`check:${number}:${sha}:${checkRun.id}`),
    upsertCommitStatus: (_repoId, sha, status) => calls.push(`status:${sha}:${status.context}`),
    upsertPullRequestCommit: (_repoId, number, commit) => calls.push(`commit:${number}:${commit.sha}`),
    upsertCompareCache: (_repoId, baseSha, headSha) => calls.push(`compare:${baseSha}:${headSha}`),
    recordUserPullRequest: (login, repoId, prNumber, relation) => calls.push(`user-pr:${login}:${repoId}:${prNumber}:${relation}`)
  },
  {
    repoId: "octo-repo",
    pullRequest: { number: 5, labels: [bug], head: { sha: "head" }, base: { sha: "base" } } as GitHubPullRequest,
    issueComments: [{ id: 21 }] as never,
    reviews: [{ id: 31, user: { login: "mona" } }] as never,
    reviewComments: [{ id: 41 }] as never,
    checkRuns: [{ id: 51 }] as never,
    statuses: [{ context: "ci" }] as never,
    commits: [{ sha: "abc" }] as never,
    compare: { status: "ahead" } as never,
    accountLogin: "mona"
  }
);
assert.ok(calls.includes("user-pr:mona:octo-repo:5:reviewed"));
assert.ok(calls.includes("compare:base:head"));

console.log("GitHub work cache persistence tests ok");
