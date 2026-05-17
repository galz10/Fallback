import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthRecoveryBanner } from "../src/renderer/components/AuthRecoveryBanner.js";
import type { AuthDegradedState } from "../src/shared/domain/auth.js";

const message = "Auth needs attention.";
const cases: Array<[AuthDegradedState["status"], string, string]> = [
  ["expired", "GitHub sign-in expired", "Reconnect"],
  ["revoked", "GitHub token rejected", "Reconnect"],
  ["insufficient_scope", "GitHub permissions needed", "Reconnect"],
  ["org_sso_required", "GitHub SSO approval required", "Review"],
  ["rate_limited", "GitHub rate limit reached", "Settings"],
  ["unknown_error", "GitHub connection needs attention", "Settings"]
];

for (const [status, title, action] of cases) {
  const html = renderToStaticMarkup(React.createElement(AuthRecoveryBanner, { auth: { status, message } }));
  assert.match(html, /data-testid="auth-recovery-banner"/);
  assert.match(html, new RegExp(`data-auth-state="${status}"`));
  assert.match(html, new RegExp(escapeRegExp(title)));
  assert.match(html, new RegExp(escapeRegExp(action)));
}

const repoHtml = renderToStaticMarkup(
  React.createElement(AuthRecoveryBanner, { auth: { status: "connected", source: "keychain" }, repoAuthError: "Repo auth failed." })
);
assert.match(repoHtml, /data-auth-state="repo_auth_error"/);
assert.match(repoHtml, /GitHub sync needs attention/);
assert.match(repoHtml, /Repo auth failed/);
assert.match(repoHtml, /Reconnect/);

const diagnoseHtml = renderToStaticMarkup(
  React.createElement(AuthRecoveryBanner, {
    auth: { status: "revoked", message: "Token rejected." },
    actionLabel: "Diagnose"
  })
);
assert.match(diagnoseHtml, /Diagnose/);

assert.equal(renderToStaticMarkup(React.createElement(AuthRecoveryBanner, { auth: { status: "connected", source: "keychain" } })), "");
assert.equal(renderToStaticMarkup(React.createElement(AuthRecoveryBanner, { auth: { status: "disconnected" } })), "");

console.log("Auth recovery banner component tests ok");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
