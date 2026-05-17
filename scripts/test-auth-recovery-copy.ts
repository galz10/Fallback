import assert from "node:assert/strict";
import { authRecoveryCopy } from "../src/shared/auth-recovery.js";
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
  const copy = authRecoveryCopy({ status, message });
  assert.equal(copy?.title, title);
  assert.equal(copy?.action, action);
  assert.match(copy?.body ?? "", /Auth needs attention|Cached data remains available/);
}

assert.equal(authRecoveryCopy({ status: "disconnected" }), null);
assert.equal(authRecoveryCopy({ status: "connected", source: "keychain" }), null);

console.log("Auth recovery copy tests ok");
