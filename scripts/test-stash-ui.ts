import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const stashWorkflowSource = readFileSync(new URL("../src/renderer/features/local-changes/StashWorkflow.tsx", import.meta.url), "utf8");
assert.match(stashWorkflowSource, /PatchRenderBoundary/);
assert.match(stashWorkflowSource, /class StashDialogBoundary/);
assert.match(stashWorkflowSource, /typeof detail\?\.patch === "string"/);
assert.match(stashWorkflowSource, /<PatchRenderBoundary patch=\{patch\}>/);
assert.match(stashWorkflowSource, /aria-pressed=\{canPreview \? Boolean\(selected\) : undefined\}/);
assert.match(stashWorkflowSource, /onClick=\{\(\) => onPreview\?\.\(stash\.ref\)\}/);
assert.match(stashWorkflowSource, /focus-visible:ring-inset/);
assert.match(stashWorkflowSource, /selected/);

const mutationsSource = readFileSync(new URL("../src/renderer/features/local-changes/useLocalChangeMutations.ts", import.meta.url), "utf8");
assert.match(
  mutationsSource,
  /const stash = useMutation\(\{[\s\S]*?await invalidateLocalChanges\(\);\r?\n\s*setStashesOpen\(true\);[\s\S]*?\}\);/
);
assert.match(
  mutationsSource,
  /const stashSelected = useMutation\(\{[\s\S]*?await invalidateLocalChanges\(\);\r?\n\s*setStashesOpen\(true\);[\s\S]*?\}\);/
);
assert.match(mutationsSource, /onSuccess: async \(result, input\)/);
assert.match(mutationsSource, /input\.action !== "drop" \|\| result\.stashes\.length === 0/);

const changedFilesSource = readFileSync(new URL("../src/renderer/features/local-changes/ChangedFilesPanel.tsx", import.meta.url), "utf8");
assert.match(changedFilesSource, /text-neutral-100/);
assert.match(changedFilesSource, /selected for stash/);
assert.match(changedFilesSource, /focus-visible:ring-2/);

console.log("Stash UI resilience tests ok");
