import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const localChangesSource = readFileSync(new URL("../src/renderer/features/local-changes/LocalChangesView.tsx", import.meta.url), "utf8");
assert.match(localChangesSource, /DiffInspector/);

const diffInspectorSource = readFileSync(new URL("../src/renderer/features/local-changes/DiffInspector.tsx", import.meta.url), "utf8");
const localFileInspectorSource = readFileSync(
  new URL("../src/renderer/features/local-changes/LocalFileInspector.tsx", import.meta.url),
  "utf8"
);
assert.match(diffInspectorSource, /LocalDiffReviewTools/);
assert.match(diffInspectorSource, /Unstaged hunks/);
assert.match(diffInspectorSource, /Staged hunks/);
assert.match(diffInspectorSource, /Search diff/);
assert.match(diffInspectorSource, /History/);
assert.match(diffInspectorSource, /Blame/);
assert.match(localFileInspectorSource, /Image diff/);
assert.match(localFileInspectorSource, /LFS pointer/);
assert.match(localFileInspectorSource, /Too large/);
assert.match(localFileInspectorSource, /Generated file/);
assert.match(localFileInspectorSource, /Permission issue/);
assert.match(diffInspectorSource, /renamed from/);
assert.match(diffInspectorSource, /Discard \{selectedLineIds\.length\}/);
assert.match(diffInspectorSource, /applyMode: "reverse"/);
assert.match(diffInspectorSource, /aria-label=\{`Select \$\{line\.type\} line/);
assert.match(diffInspectorSource, /focus:border-neutral-600/);

const localGitHandlers = readFileSync(new URL("../electron/main/ipc/local-git.handlers.ts", import.meta.url), "utf8");
assert.match(localGitHandlers, /reposApplyLocalPatch/);
assert.match(localGitHandlers, /operations\.applyLocalPatch\(id, patchInput\)/);

const localGitOperations = readFileSync(new URL("../electron/main/modules/local-git/local-git-operations.ts", import.meta.url), "utf8");
assert.match(localGitOperations, /local_patch_\$\{input\.action\}/);
assert.match(localGitOperations, /input\.action === "discard"/);

const operationCatalog = readFileSync(
  new URL("../electron/main/modules/local-git/local-git-operation-catalog.ts", import.meta.url),
  "utf8"
);
assert.match(operationCatalog, /local_patch_discard/);

console.log("Local diff UI wiring tests ok");
