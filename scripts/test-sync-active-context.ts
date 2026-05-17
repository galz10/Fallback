import assert from "node:assert/strict";
import { buildSyncActiveContext, isRepoScopedView } from "../src/renderer/sync-active-context.js";

assert.equal(isRepoScopedView("Code"), true);
assert.equal(isRepoScopedView("home"), false);

assert.deepEqual(
  buildSyncActiveContext({
    view: "Code",
    selectedRepoId: "repo-1",
    selectedPrNumber: null,
    selectedIssueNumber: null,
    selectedMyPr: null,
    selectedMyIssue: null,
    visible: true,
    online: true
  }),
  {
    repoId: "repo-1",
    view: "Code",
    prNumber: null,
    issueNumber: null,
    visible: true,
    online: true
  }
);

assert.deepEqual(
  buildSyncActiveContext({
    view: "Pull requests",
    selectedRepoId: "repo-1",
    selectedPrNumber: 12,
    selectedIssueNumber: null,
    selectedMyPr: null,
    selectedMyIssue: null,
    visible: true,
    online: true
  }),
  {
    repoId: "repo-1",
    view: "Pull requests",
    prNumber: 12,
    issueNumber: null,
    visible: true,
    online: true
  }
);

assert.deepEqual(
  buildSyncActiveContext({
    view: "My Work",
    selectedRepoId: "repo-1",
    selectedPrNumber: null,
    selectedIssueNumber: null,
    selectedMyPr: { repoId: "repo-2", number: 9 },
    selectedMyIssue: null,
    visible: false,
    online: false
  }),
  {
    repoId: "repo-2",
    view: "My Work",
    prNumber: 9,
    issueNumber: null,
    visible: false,
    online: false
  }
);

assert.deepEqual(
  buildSyncActiveContext({
    view: "home",
    selectedRepoId: "repo-1",
    selectedPrNumber: null,
    selectedIssueNumber: null,
    selectedMyPr: null,
    selectedMyIssue: null,
    visible: true,
    online: true
  }),
  {
    repoId: null,
    view: "home",
    prNumber: null,
    issueNumber: null,
    visible: true,
    online: true
  }
);

console.log("Sync active context tests ok");
