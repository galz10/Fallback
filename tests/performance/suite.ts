import { runScriptTests } from "../fixtures/test-suite.js";

await runScriptTests(["scripts/test-performance-guardrails.ts", "scripts/test-performance-fixtures.ts"]);
