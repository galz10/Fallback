import { runScriptTests } from "../fixtures/test-suite.js";

await runScriptTests([
  "scripts/validate-ipc-contract.ts",
  "scripts/test-electron-security.ts",
  "scripts/test-repo-path-safety.ts",
  "scripts/test-git-input-validation.ts",
  "scripts/test-settings-validation.ts",
  "scripts/test-operation-policy.ts",
  "scripts/test-p0-trust-foundation.ts",
  "scripts/test-credential-diagnostics.ts",
  "scripts/test-linux-diagnostics.ts",
  "scripts/test-shell-handoff.ts",
  "scripts/test-diagnostics-redaction.ts"
]);
