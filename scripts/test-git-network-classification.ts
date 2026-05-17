import assert from "node:assert/strict";
import { classifyGitNetworkError, LocalGitNetworkError } from "../electron/main/local-git-service.js";

assert.equal(
  classifyGitNetworkError(new Error("Authentication failed for 'https://github.com/octo/repo'"), "rejected").status,
  "auth_failed"
);
assert.equal(classifyGitNetworkError(new Error("Permission denied (publickey)."), "rejected").diagnosticsRecommended, true);
assert.equal(
  classifyGitNetworkError(new Error("fatal: The current branch main has no upstream branch."), "rejected").status,
  "no_upstream"
);
assert.equal(classifyGitNetworkError(new Error("! [rejected] main -> main (non-fast-forward)"), "rejected").status, "non_fast_forward");
assert.equal(
  classifyGitNetworkError(new Error("fatal: unable to access: Could not resolve host: github.com"), "rejected").status,
  "remote_unavailable"
);
assert.equal(classifyGitNetworkError(new Error("CONFLICT (content): Merge conflict in README.md"), "rejected").status, "conflict");
assert.equal(
  classifyGitNetworkError(new Error("remote: error: GH006: Protected branch update failed"), "rejected").status,
  "protected_branch"
);

const dirty = new LocalGitNetworkError("dirty_worktree", "Commit, stash, or discard local changes before pulling.");
assert.equal(dirty.fallbackCode, "git_network_dirty_worktree");
assert.equal(dirty.diagnosticsRecommended, false);

console.log("Git network classification tests ok");
