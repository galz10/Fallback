import { runScriptTests } from "../fixtures/test-suite.js";

await runScriptTests([
  "scripts/test-github-client.ts",
  "scripts/test-sync-policy.ts",
  "scripts/test-sync-scheduler-startup.ts",
  "scripts/test-sync-active-context.ts",
  "scripts/test-repo-sync-pipeline.ts",
  "scripts/test-sync-service.ts",
  "scripts/test-actions.ts",
  "scripts/test-actions-query.ts",
  "scripts/test-app-update-service.ts"
]);
