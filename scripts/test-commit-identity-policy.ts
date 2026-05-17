import assert from "node:assert/strict";
import { commitIdentityPolicy } from "../src/shared/commit-identity-policy.js";
import type { RepoIdentity } from "../src/shared/domain/repo-identity.js";

const healthy = identity();
assert.equal(commitIdentityPolicy(healthy).status, "ok");

const mismatch = commitIdentityPolicy(identity({ currentGitEmail: "wrong@example.com" }));
assert.equal(mismatch.status, "blocked");
assert.equal(mismatch.quickFix, "apply_repo_identity");
assert.match(mismatch.message ?? "", /wrong@example.com/);
assert.match(mismatch.message ?? "", /mona@example.com/);

const unverified = commitIdentityPolicy(identity({ verifiedEmailStatus: "failed" }));
assert.equal(unverified.status, "blocked");
assert.match(unverified.message ?? "", /not verified/);

const degraded = commitIdentityPolicy(identity({ accountStatus: "org_sso_required" }));
assert.equal(degraded.status, "blocked");
assert.match(degraded.message ?? "", /org sso required/);

const unknownEmail = commitIdentityPolicy(identity({ verifiedEmailStatus: "unknown" }));
assert.equal(unknownEmail.status, "warning");
assert.equal(unknownEmail.canBypass, true);
assert.equal(commitIdentityPolicy(identity({ verifiedEmailStatus: "unknown" }), { bypassed: true }).status, "ok");

const signing = commitIdentityPolicy(identity({ signingMode: "ssh", currentSigningMode: "unsigned" }));
assert.equal(signing.status, "blocked");
assert.match(signing.message ?? "", /signing is not active/);

const missingSigningKey = commitIdentityPolicy(
  identity({
    signingMode: "ssh",
    currentSigningMode: "ssh",
    signingHealth: "missing_key",
    signingHealthMessage: "SSH commit signing key file is missing (id_ed25519.pub)."
  })
);
assert.equal(missingSigningKey.status, "blocked");
assert.match(missingSigningKey.message ?? "", /missing/);
assert.match(missingSigningKey.action ?? "", /user\.signingkey/);

console.log("Commit identity policy tests ok");

function identity(overrides: Partial<RepoIdentity> = {}): RepoIdentity {
  return {
    repoId: "repo-1",
    accountId: "account-1",
    accountLogin: "mona",
    accountEndpoint: "https://api.github.com",
    accountStatus: "connected",
    gitName: "Mona",
    gitEmail: "mona@example.com",
    signingMode: "unsigned",
    signingKeyHint: null,
    remoteProtocol: "https",
    verifiedEmailStatus: "ok",
    lastCheckedAt: "2026-05-03T00:00:00.000Z",
    lastCheckStatus: "ok",
    currentGitName: "Mona",
    currentGitEmail: "mona@example.com",
    currentSigningMode: "unsigned",
    currentSigningKeyHint: null,
    currentGpgProgram: null,
    signingHealth: "unsigned",
    signingHealthMessage: "Commit signing is off for this repository.",
    branch: "main",
    remoteUrl: "https://github.com/octo/repo.git",
    localPath: "/tmp/repo",
    mismatchReason: null,
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z",
    ...overrides
  };
}
