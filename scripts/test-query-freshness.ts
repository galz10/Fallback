import assert from "node:assert/strict";
import { rendererFreshnessKeys } from "../src/renderer/app/query-freshness.js";

assert.deepEqual(rendererFreshnessKeys({ type: "sync", repoId: "octo-repo" }).slice(0, 4), [
  ["repos"],
  ["repoWorkspaces", "octo-repo"],
  ["repoCodeSummary", "octo-repo"],
  ["repoFiles", "octo-repo"]
]);

assert.deepEqual(rendererFreshnessKeys({ type: "repos" }), [
  ["repos"],
  ["availableRepos"],
  ["myPrs"],
  ["myIssues"],
  ["cache"],
  ["cacheDetailed"]
]);

assert.deepEqual(rendererFreshnessKeys({ type: "localChanges", repoId: "octo-repo" }), [
  ["localChangesSummary"],
  ["localChanges", "octo-repo"],
  ["localChangePatch", "octo-repo"],
  ["conflictState", "octo-repo"],
  ["repoCodeSummary", "octo-repo"],
  ["repoFiles", "octo-repo"],
  ["repoWorkspaces", "octo-repo"],
  ["commitGraph", "octo-repo"]
]);

assert.deepEqual(rendererFreshnessKeys({ type: "branchIntegrity", repoId: "octo-repo" }), [
  ["branchIntegritySummaries"],
  ["branchIntegritySummary", "octo-repo"],
  ["branchIntegrityFindings", "octo-repo"]
]);

assert.deepEqual(rendererFreshnessKeys({ type: "health" }), [["offlineStatus"], ["health"], ["healthHistory"]]);

console.log("Query freshness tests ok");
