import { runScriptTests } from "../fixtures/test-suite.js";

await runScriptTests([
  "scripts/test-command-palette-logic.ts",
  "scripts/test-query-freshness.ts",
  "scripts/test-window-context.ts",
  "scripts/test-window-context-ui.ts",
  "scripts/test-repo-workspaces-ui.ts",
  "scripts/test-git-network-ui.ts",
  "scripts/test-conflict-ui.ts",
  "scripts/test-local-diff-ui.ts",
  "scripts/test-confirm-dialog.ts",
  "scripts/test-operation-status-panel.ts",
  "scripts/test-commit-identity-warning-panel.ts",
  "scripts/test-commit-template-controls.ts",
  "scripts/test-connectivity-recovery-ui.ts",
  "scripts/test-pr-review-polish-ui.ts",
  "scripts/test-stash-ui.ts",
  "scripts/test-selective-file-stash-ui.ts",
  "scripts/test-app-update-ui.ts"
]);
