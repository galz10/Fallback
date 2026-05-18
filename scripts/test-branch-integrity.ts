import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { classifyBranchIntegrity, diffStatSuspicion, parsePullRequestNumbersFromCommitMessage } from "../src/shared/branch-integrity.js";
import type { BranchCommitObservation, MergeEvidence } from "../src/shared/domain/branch-integrity.js";
import type { PullRequestSummary } from "../src/shared/domain/github-work.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

assert.deepEqual(parsePullRequestNumbersFromCommitMessage("Merge pull request #12 from x\n\nRefs #99"), [12]);
assert.deepEqual(parsePullRequestNumbersFromCommitMessage("ship integrity checks (#41)\n\nPR #42"), [41, 42]);

assert.equal(
  diffStatSuspicion({ additions: 5000, deletions: 200, changedFiles: 12 }, { additions: 100, deletions: 20, changedFiles: 3 }).kind,
  "landed_diff_too_large"
);
assert.equal(
  diffStatSuspicion({ additions: 1, deletions: 0, changedFiles: 1 }, { additions: 900, deletions: 200, changedFiles: 12 }).kind,
  "landed_diff_too_small"
);

const commit: BranchCommitObservation = {
  sha: "landed",
  treeSha: "landed-tree",
  parentShas: ["parent"],
  parentSha: "parent",
  firstParentSha: "parent",
  subject: "Merge pull request #7",
  body: "",
  authorName: "User",
  authorEmail: "user@example.com",
  committedAt: new Date().toISOString(),
  additions: 10,
  deletions: 5,
  changedFiles: 2,
  files: [],
  prNumbers: [7]
};
const evidence: MergeEvidence = {
  repoId: "repo",
  branchName: "main",
  landedSha: "landed",
  landedTreeSha: "landed-tree",
  landedParentSha: "parent",
  prNumbers: [7],
  mergeMethod: "merge",
  mergeSource: "merge_queue",
  expectedHeadSha: null,
  expectedTreeSha: null,
  testedSha: "tested",
  testedTreeSha: "tested-tree",
  mergeGroupRef: "refs/fallback/merge-groups/1",
  workflowRunId: 1,
  workflowRunUrl: null,
  checkState: "passing",
  observedAt: new Date().toISOString()
};
const findings = classifyBranchIntegrity({
  repoId: "repo",
  branchName: "main",
  commit,
  evidence,
  pullRequests: [],
  safetyRefsAvailable: true
});
assert.equal(findings[0]?.kind, "tested_tree_mismatch");
assert.equal(findings[0]?.severity, "critical");
const rollbackFindings = classifyBranchIntegrity({
  repoId: "repo",
  branchName: "main",
  commit: { ...commit, additions: 20, deletions: 900, prNumbers: [8] },
  evidence: { ...evidence, testedTreeSha: null, prNumbers: [8] },
  pullRequests: [],
  safetyRefsAvailable: true
});
assert.equal(
  rollbackFindings.some((finding) => finding.kind === "possible_reversion" && finding.severity === "high"),
  true
);
const partialCachedPr: PullRequestSummary = {
  id: "repo/pull/7",
  repoId: "repo",
  number: 7,
  title: "Cached without diff stats",
  body: null,
  authorLogin: null,
  assigneeLogins: [],
  requestedReviewerLogins: [],
  state: "closed",
  isDraft: false,
  merged: true,
  headSha: "head",
  baseSha: "base",
  baseBranch: "main",
  headBranch: "feature",
  additions: null,
  deletions: null,
  changedFiles: null,
  commitsCount: null,
  commentsCount: null,
  reviewCommentsCount: null,
  reviewState: null,
  checkState: "unknown",
  checkCount: 0,
  labels: [],
  htmlUrl: null,
  createdAt: null,
  updatedAt: null,
  closedAt: null,
  mergedAt: null,
  lastSyncedAt: null
};
const incompleteMetadataFindings = classifyBranchIntegrity({
  repoId: "repo",
  branchName: "main",
  commit: { ...commit, additions: 400, deletions: 5 },
  evidence: { ...evidence, testedTreeSha: null },
  pullRequests: [partialCachedPr],
  safetyRefsAvailable: true
});
assert.equal(
  incompleteMetadataFindings.some((finding) => finding.kind === "landed_diff_too_large"),
  false
);

const repoDir = await mkdtemp(path.join(tmpdir(), "fallback-branch-integrity-fixture-"));
await git(repoDir, ["init", "-b", "main"]);
await git(repoDir, ["config", "user.name", "Fallback Test"]);
await git(repoDir, ["config", "user.email", "fallback@example.com"]);
await writeFile(path.join(repoDir, "app.txt"), "one\n");
await git(repoDir, ["add", "app.txt"]);
await git(repoDir, ["commit", "-m", "initial"]);
await writeFile(path.join(repoDir, "app.txt"), "one\ntested\n");
await git(repoDir, ["commit", "-am", "tested merge group (#1)"]);
const testedSha = await git(repoDir, ["rev-parse", "HEAD"]);
await git(repoDir, ["update-ref", "refs/fallback/merge-groups/1", testedSha]);
await writeFile(path.join(repoDir, "app.txt"), "one\nlanded-wrong\n");
await git(repoDir, ["commit", "-am", "landed wrong (#1)"]);
const tsxCli = require.resolve("tsx/cli");
const { stdout } = await execFileAsync(
  process.execPath,
  [tsxCli, "scripts/audit-branch-integrity.ts", "--repo", repoDir, "--branch", "main", "--json"],
  {
    cwd: path.resolve("."),
    encoding: "utf8"
  }
);
const report = parseJsonReport(stdout) as { findings: Array<{ kind: string; severity: string }> };
assert.equal(
  report.findings.some((finding) => finding.kind === "tested_tree_mismatch" && finding.severity === "critical"),
  true
);

console.log("branch integrity tests passed");

function parseJsonReport(stdout: string): unknown {
  const start = stdout.indexOf("{");
  if (start < 0) throw new Error(`Expected JSON report on stdout, received: ${stdout.slice(0, 300)}`);
  return JSON.parse(stdout.slice(start));
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout.trim();
}
