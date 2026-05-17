import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { triagePullRequest } from "../src/shared/triage.js";
import type { PullRequestSummary } from "../src/shared/domain/github-work.js";

const pr: PullRequestSummary = {
  id: "pr",
  repoId: "repo",
  number: 42,
  title: "Improve queue",
  body: "Please review @mona",
  authorLogin: "octocat",
  assigneeLogins: ["mona"],
  requestedReviewerLogins: ["mona"],
  state: "open",
  isDraft: false,
  merged: false,
  repoFullName: "octo/repo",
  headSha: "head",
  baseSha: "base",
  baseBranch: "main",
  headBranch: "queue",
  additions: 12,
  deletions: 2,
  changedFiles: 3,
  commitsCount: 1,
  commentsCount: 2,
  reviewCommentsCount: 1,
  reviewState: null,
  checkState: "failing",
  checkCount: 3,
  labels: ["bug", "priority"],
  htmlUrl: "https://github.com/octo/repo/pull/42",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: new Date().toISOString(),
  closedAt: null,
  mergedAt: null,
  lastSyncedAt: "2026-01-02T00:00:00Z"
};

const html = renderToStaticMarkup(React.createElement(TriagePrRow, { pr, login: "mona" }));
assert.match(html, /Improve queue/);
assert.match(html, /octo\/repo/);
assert.match(html, /Review requested/);
assert.match(html, /Checks failing/);
assert.match(html, /bug/);
assert.match(html, /priority/);
assert.match(html, /3 comments/);

console.log("Triage row rendering tests ok");

function TriagePrRow({ pr, login }: { pr: PullRequestSummary; login: string }) {
  const triage = triagePullRequest(pr, login);
  return React.createElement(
    "article",
    { "data-testid": "triage-pr-row" },
    React.createElement("h2", null, `#${pr.number} ${pr.title}`),
    React.createElement("p", null, pr.repoFullName),
    React.createElement("span", null, triage.attentionReason),
    React.createElement("span", null, pr.checkState === "failing" ? "Checks failing" : pr.checkState),
    React.createElement(
      "ul",
      null,
      pr.labels.map((label) => React.createElement("li", { key: label }, label))
    ),
    React.createElement("span", null, `${(pr.commentsCount ?? 0) + (pr.reviewCommentsCount ?? 0)} comments`)
  );
}
