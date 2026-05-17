import assert from "node:assert/strict";
import { parseGitWorktreePorcelain } from "../src/shared/git-worktree-parser.js";

const output = [
  "worktree /tmp/repo",
  `HEAD ${"a".repeat(40)}`,
  "branch refs/heads/main",
  "",
  "worktree /tmp/repo-feature",
  `HEAD ${"b".repeat(40)}`,
  "branch refs/heads/feature/workspaces",
  "locked testing lock",
  "",
  "worktree /tmp/repo-detached",
  `HEAD ${"c".repeat(40)}`,
  "detached",
  "prunable gitdir file points to non-existent location",
  "",
  "worktree /tmp/repo-bare",
  "bare"
].join("\n");

const parsed = parseGitWorktreePorcelain(output);
assert.equal(parsed.length, 4);
assert.equal(parsed[0]?.localPath, "/tmp/repo");
assert.equal(parsed[0]?.branch, "main");
assert.equal(parsed[0]?.detached, false);
assert.equal(parsed[1]?.branch, "feature/workspaces");
assert.equal(parsed[1]?.locked, true);
assert.equal(parsed[1]?.lockReason, "testing lock");
assert.equal(parsed[2]?.branch, null);
assert.equal(parsed[2]?.detached, true);
assert.equal(parsed[2]?.prunable, true);
assert.match(parsed[2]?.pruneReason ?? "", /non-existent/);
assert.equal(parsed[3]?.bare, true);
assert.equal(parsed[3]?.branch, null);
assert.equal(parsed[3]?.headSha, null);

const nulParsed = parseGitWorktreePorcelain(output.replaceAll("\n", "\0"));
assert.deepEqual(nulParsed, parsed);

console.log("Git worktree parser tests ok");
