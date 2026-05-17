import assert from "node:assert/strict";
import { filterActionChecks, filterWorkflowRuns } from "../src/renderer/features/actions/actions-query.js";
import type { ActionCheckSummary, WorkflowRunSummary } from "../src/shared/domain/github-work.js";

const check: ActionCheckSummary = {
  id: "check-1",
  repoId: "repo",
  repoFullName: "octo/repo",
  kind: "check_run",
  name: "Unit Tests",
  status: "completed",
  conclusion: "success",
  state: "passing",
  branch: "main",
  commitSha: "abc123456789",
  prNumber: 42,
  prTitle: "Improve filters",
  htmlUrl: "https://github.com/octo/repo/runs/1",
  detailsUrl: null,
  targetUrl: null,
  description: "CI suite",
  startedAt: "2026-01-12T12:00:00.000Z",
  completedAt: "2026-01-12T12:03:00.000Z",
  updatedAt: "2026-01-12T12:03:00.000Z",
  lastSyncedAt: "2026-01-12T12:04:00.000Z"
};

const pendingCheck: ActionCheckSummary = {
  ...check,
  id: "check-2",
  name: "Lint",
  conclusion: null,
  state: "pending",
  prNumber: null
};

const run: WorkflowRunSummary = {
  id: "run-1",
  repoId: "repo",
  repoFullName: "octo/repo",
  githubWorkflowRunId: 100,
  workflowName: "Release",
  displayTitle: "Ship v1",
  runNumber: 77,
  runAttempt: 1,
  event: "push",
  status: "completed",
  conclusion: "failure",
  state: "failing",
  headBranch: "release",
  headSha: "def456789012",
  htmlUrl: "https://github.com/octo/repo/actions/runs/100",
  actorLogin: "mona",
  path: ".github/workflows/release.yml",
  runStartedAt: "2026-01-13T12:00:00.000Z",
  createdAt: "2026-01-13T12:00:00.000Z",
  updatedAt: "2026-01-13T12:05:00.000Z",
  lastSyncedAt: "2026-01-13T12:06:00.000Z"
};

assert.deepEqual(
  filterActionChecks([check, pendingCheck], "status:pending").map((item) => item.id),
  ["check-2"]
);
assert.equal(filterActionChecks([check], "status:all branch:main pr:42 workflow:unit sha:abc123").length, 1);
assert.equal(filterActionChecks([check], "status:passing -pr:42").length, 0);
assert.equal(filterActionChecks([check], "-workflow:unit").length, 0);
assert.equal(filterWorkflowRuns([run], "status:failing branch:release event:push actor:mona workflow:release run:77").length, 1);
assert.equal(filterWorkflowRuns([run], "is:all -actor:mona").length, 0);
assert.equal(filterWorkflowRuns([run], "sha:def456 path:release.yml").length, 1);

console.log("Actions query tests ok");
