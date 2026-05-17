import assert from "node:assert/strict";
import { buildFilterSuggestions } from "../src/renderer/features/github-work/work-query-language.js";
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

const items = [prBase, issueBase];
const suggestionOptions = {
  issueTypes: ["Bug", "Task", "Workstream", "Feature"],
  issueFieldOptions: {
    priority: ["P0", "P1", "P2"],
    effort: ["Small", "Medium", "Large"]
  }
};

assert.deepEqual(
  buildFilterSuggestions("type:", items, "mona", ["pr", "issue"], suggestionOptions).map((suggestion) => suggestion.value),
  ["type:pr", "type:issue", "type:Bug", "type:Feature", "type:Task", "type:Workstream"]
);
assert.deepEqual(
  buildFilterSuggestions("type:", items, "mona", ["pr"], suggestionOptions).map((suggestion) => suggestion.value),
  ["type:pr"]
);
assert.deepEqual(
  buildFilterSuggestions("type:", items, "mona", ["issue"], suggestionOptions).map((suggestion) => suggestion.value),
  ["type:Bug", "type:Feature", "type:Task", "type:Workstream"]
);

const issueQualifierValues = buildFilterSuggestions("", [issueBase], "mona", ["issue"]).map((suggestion) => suggestion.value);
assert.equal(issueQualifierValues.includes("base:"), false);
assert.equal(issueQualifierValues.includes("review-state:"), false);
for (const qualifier of issueQualifierValues.filter((value) => value.endsWith(":"))) {
  assert.ok(buildFilterSuggestions(qualifier, [issueBase], "mona", ["issue"]).length > 0, `Expected suggestions for ${qualifier}`);
}

const prQualifierValues = buildFilterSuggestions("", [prBase], "mona", ["pr"]).map((suggestion) => suggestion.value);
assert.equal(prQualifierValues.includes("base:"), true);
assert.equal(prQualifierValues.includes("review-state:"), true);
for (const qualifier of prQualifierValues.filter((value) => value.endsWith(":"))) {
  assert.ok(buildFilterSuggestions(qualifier, [prBase], "mona", ["pr"]).length > 0, `Expected suggestions for ${qualifier}`);
}

assert.ok(buildFilterSuggestions("label:", items, "mona", ["pr", "issue"]).some((suggestion) => suggestion.value === "label:backend"));
assert.ok(
  buildFilterSuggestions("priority:", items, "mona", ["pr", "issue"], suggestionOptions).some(
    (suggestion) => suggestion.value === "priority:P1"
  )
);
assert.ok(
  buildFilterSuggestions("effort:", items, "mona", ["pr", "issue"], suggestionOptions).some(
    (suggestion) => suggestion.value === "effort:Small"
  )
);
assert.equal(
  buildFilterSuggestions("priority:", items, "mona", ["pr", "issue"]).some((suggestion) => suggestion.value === "priority:bug"),
  false
);
assert.ok(
  buildFilterSuggestions("reviewed-by:", items, "mona", ["pr", "issue"]).some((suggestion) => suggestion.value === "reviewed-by:@me")
);
assert.ok(buildFilterSuggestions("archived:", items, "mona", ["pr", "issue"]).some((suggestion) => suggestion.value === "archived:false"));
assert.ok(
  buildFilterSuggestions("closed-reason:", items, "mona", ["pr", "issue"]).some(
    (suggestion) => suggestion.value === "closed-reason:not_planned"
  )
);
assert.ok(buildFilterSuggestions("sort:", items, "mona", ["pr", "issue"]).some((suggestion) => suggestion.value === "sort:updated-desc"));

console.log("Entity filter suggestion tests ok");
