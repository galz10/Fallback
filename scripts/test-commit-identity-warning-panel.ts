import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommitIdentityWarningPanel } from "../src/renderer/components/CommitIdentityWarningPanel.js";
import type { CommitIdentityPolicyState } from "../src/shared/commit-identity-policy.js";

const blocked = render(
  {
    status: "blocked",
    message: "Repo-local commit email is wrong@example.com.",
    action: "Apply the repo identity before committing.",
    canBypass: false,
    quickFix: "apply_repo_identity",
    expectedSigningMode: "unsigned",
    signingKeyHint: null,
    signingEnforcement: "none"
  },
  false
);
assert.match(blocked, /Commit blocked/);
assert.match(blocked, /Apply repo identity/);
assert.doesNotMatch(blocked, /Commit anyway/);

const warning = render(
  {
    status: "warning",
    message: "Fallback could not confirm this email.",
    action: "Run diagnostics or continue intentionally.",
    canBypass: true,
    quickFix: null,
    expectedSigningMode: "unsigned",
    signingKeyHint: null,
    signingEnforcement: "none"
  },
  true
);
assert.match(warning, /Email verification/);
assert.match(warning, /Commit anyway/);
assert.match(warning, /checked/);

console.log("Commit identity warning panel tests ok");

function render(state: CommitIdentityPolicyState, bypassed: boolean): string {
  return renderToStaticMarkup(
    React.createElement(CommitIdentityWarningPanel, {
      state,
      bypassed,
      onBypassChange: () => undefined,
      onApplyIdentity: () => undefined
    })
  );
}
