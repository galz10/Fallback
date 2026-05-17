import { runScriptTests } from "../fixtures/test-suite.js";

await runScriptTests([
  "scripts/test-attention.ts",
  "scripts/test-product-coherence-copy.ts",
  "scripts/test-branch-integrity.ts",
  "scripts/test-branch-integrity-monitor.ts",
  "scripts/test-repo-display.ts",
  "scripts/test-repo-display-smoke.ts",
  "scripts/test-repo-file-preview.ts",
  "scripts/test-repo-branch-switch.ts",
  "scripts/test-commit-history-search.ts",
  "scripts/test-commit-history-fixture.ts",
  "scripts/test-commit-graph-layout.ts",
  "scripts/test-commit-graph-fixture.ts",
  "scripts/test-commit-graph-ui.ts",
  "scripts/test-releases-tab.ts",
  "scripts/test-signing-setup-ui.ts"
]);
