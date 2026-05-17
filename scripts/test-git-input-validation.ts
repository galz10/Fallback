import assert from "node:assert/strict";
import {
  assertGitBranchName,
  assertGitCommitSha,
  assertGitRefName,
  assertGitRemoteName,
  assertGitStashRef,
  assertRepoRelativePath
} from "../electron/main/git-input-validation.js";

assert.equal(assertGitBranchName("feature/ship-it"), "feature/ship-it");
assert.equal(assertGitRemoteName("origin"), "origin");
assert.equal(assertGitRefName("refs/heads/main"), "refs/heads/main");
assert.equal(assertGitCommitSha("abc1234"), "abc1234");
assert.equal(assertGitStashRef("stash@{0}"), "stash@{0}");
assert.equal(assertRepoRelativePath("src/index.ts"), "src/index.ts");
assert.equal(assertRepoRelativePath("", "Path", { allowRoot: true }), "");

assert.throws(() => assertGitBranchName("--delete"), /must not start/);
assert.throws(() => assertGitBranchName("bad branch"), /invalid Git ref/);
assert.throws(() => assertGitBranchName("HEAD"), /not HEAD/);
assert.throws(() => assertGitRemoteName("https://example.com/repo.git"), /configured remote name/);
assert.throws(() => assertGitCommitSha("not-a-sha"), /hexadecimal/);
assert.throws(() => assertGitStashRef("main"), /stash@\{0\}/);
assert.throws(() => assertRepoRelativePath(""), /non-empty string/);
assert.throws(() => assertRepoRelativePath("../secret.txt"), /inside the repository/);
assert.throws(() => assertRepoRelativePath("/tmp/secret.txt"), /relative to the repository/);

console.log("Git input validation tests ok");
