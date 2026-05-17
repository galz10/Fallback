import { runScriptTests } from "../fixtures/test-suite.js";

await runScriptTests([
  "scripts/test-github-work-cache-persistence.ts",
  "scripts/test-entity-query-filters.ts",
  "scripts/test-entity-filter-suggestions.ts",
  "scripts/test-saved-entity-searches.ts",
  "scripts/test-offline-actions.ts",
  "scripts/test-pr-review-drafts.ts",
  "scripts/test-triage.ts",
  "scripts/test-triage-row.ts"
]);
