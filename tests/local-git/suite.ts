import { runScriptTests } from "../fixtures/test-suite.js";

await runScriptTests([
  "scripts/test-git-worktree-parser.ts",
  "scripts/test-repo-workspaces.ts",
  "scripts/test-workspace-managed-folders.ts",
  "scripts/test-git-network.ts",
  "scripts/test-git-network-classification.ts",
  "scripts/test-conflict-prevention.ts",
  "scripts/test-local-git-summary.ts",
  "scripts/test-workspace-branch-refresh.ts",
  "scripts/test-local-changes-tree.ts",
  "scripts/test-local-changes-filter-bar.ts",
  "scripts/test-local-diff-patches.ts",
  "scripts/test-local-diff-actions.ts",
  "scripts/test-stash-preview.ts",
  "scripts/test-selective-file-stash.ts",
  "scripts/test-commit-signing-failure.ts",
  "scripts/test-commit-identity-policy.ts",
  "scripts/test-commit-templates.ts",
  "scripts/test-recovery-records.ts"
]);
