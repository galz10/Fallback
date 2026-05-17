import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IdentityRiskWarning } from "../src/renderer/components/IdentityRiskWarning.js";
import { identityRisk } from "../src/shared/identity-risk.js";
import type { RepoIdentity } from "../src/shared/domain/repo-identity.js";

const healthy = identity({
  accountId: "account-1",
  accountLogin: "mona",
  gitEmail: "mona@example.com",
  currentGitEmail: "mona@example.com",
  lastCheckStatus: "ok",
  verifiedEmailStatus: "ok"
});

assert.equal(identityRisk(healthy, "commit").level, "ok");
assert.equal(identityRisk(healthy, "github").message, null);
assert.equal(renderRisk(identityRisk(healthy, "github")), "");

const loadingRisk = identityRisk(null, "commit");
assert.match(loadingRisk.message ?? "", /Identity is still loading/);
assert.match(renderRisk(loadingRisk), /data-testid="identity-risk-warning"/);

const missingRisk = identityRisk(identity({ accountId: null, accountLogin: null }), "github");
assert.match(missingRisk.message ?? "", /No GitHub account is bound/);
assert.match(renderRisk(missingRisk), /No GitHub account is bound/);

const degradedRisk = identityRisk(identity({ accountStatus: "revoked" }), "github");
assert.match(degradedRisk.message ?? "", /revoked/);
assert.match(renderRisk(degradedRisk), /revoked/);

const degradedCommitRisk = identityRisk(identity({ accountStatus: "revoked" }), "commit");
assert.match(degradedCommitRisk.message ?? "", /before you commit/);
assert.match(renderRisk(degradedCommitRisk), /before you commit/);

const degradedReviewRisk = identityRisk(identity({ accountStatus: "revoked" }), "github");
assert.match(degradedReviewRisk.message ?? "", /before you write to GitHub/);
assert.match(renderRisk(degradedReviewRisk), /before you write to GitHub/);

const degradedSyncRisk = identityRisk(identity({ accountStatus: "revoked" }), "sync");
assert.match(degradedSyncRisk.message ?? "", /before you sync/);
assert.match(renderRisk(degradedSyncRisk), /before you sync/);

const mismatchRisk = identityRisk(identity({ mismatchReason: "Bound account cannot access this repo." }), "git");
assert.equal(mismatchRisk.message, "Bound account cannot access this repo.");
assert.match(renderRisk(mismatchRisk), /Bound account cannot access this repo/);

assert.match(identityRisk(identity({ lastCheckStatus: "failed" }), "github").message ?? "", /credential check failed/i);

assert.match(identityRisk(identity({ gitEmail: null, currentGitEmail: null }), "commit").message ?? "", /No commit email is configured/);

assert.match(identityRisk(identity({ verifiedEmailStatus: "failed" }), "commit").message ?? "", /not verified/);

console.log("Identity risk tests ok");

function renderRisk(risk: ReturnType<typeof identityRisk>): string {
  return renderToStaticMarkup(React.createElement(IdentityRiskWarning, { risk }));
}

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
    branch: "main",
    remoteUrl: "https://github.com/octo/repo.git",
    localPath: "/tmp/repo",
    mismatchReason: null,
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z",
    ...overrides
  };
}
