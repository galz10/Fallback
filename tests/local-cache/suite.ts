import { runScriptTests } from "../fixtures/test-suite.js";

await runScriptTests([
  "scripts/test-attention-service.ts",
  "scripts/test-auth-service.ts",
  "scripts/test-auth-classification.ts",
  "scripts/test-auth-recovery-copy.ts",
  "scripts/test-auth-recovery-banner.ts",
  "scripts/test-account-session.ts",
  "scripts/test-repo-groups.ts",
  "scripts/test-repo-schema-migration.ts",
  "scripts/test-closed-issue-cache-retention.ts",
  "scripts/test-operation-record-store.ts",
  "scripts/test-operation-service.ts",
  "scripts/test-operation-recovery.ts",
  "scripts/test-identity-risk.ts",
  "scripts/test-signing-config.ts",
  "scripts/test-signing-readiness.ts",
  "scripts/test-health-service.ts"
]);
