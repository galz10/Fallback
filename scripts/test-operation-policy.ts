import assert from "node:assert/strict";
import { allLocalGitOperationPolicies } from "../electron/main/modules/local-git/local-git-operation-catalog.js";

const destructive = allLocalGitOperationPolicies().filter((policy) => policy.riskLevel === "destructive");
assert.ok(destructive.length > 0, "Expected at least one destructive local Git operation policy.");

for (const policy of destructive) {
  assert.ok(
    policy.capturesRecovery || policy.recoveryException,
    `${policy.kind} is destructive and must capture recovery metadata or document an explicit exception.`
  );
  if (policy.capturesRecovery) {
    assert.ok(policy.createsSafetyRef, `${policy.kind} is destructive and should create a safety ref when recovery is captured.`);
  }
}

console.log("Operation policy tests ok");
