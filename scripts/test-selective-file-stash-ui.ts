import assert from "node:assert/strict";
import { selectiveStashActionState } from "../src/shared/selective-file-stash.js";

assert.equal(selectiveStashActionState({ selectedCount: 0, busy: false, isDirty: true }).enabled, false);
assert.equal(selectiveStashActionState({ selectedCount: 2, busy: true, isDirty: true }).enabled, false);
assert.equal(selectiveStashActionState({ selectedCount: 2, busy: false, isDirty: false }).enabled, false);

const enabled = selectiveStashActionState({ selectedCount: 2, busy: false, isDirty: true });
assert.equal(enabled.enabled, true);
assert.equal(enabled.label, "Stash 2 selected files");
assert.equal(selectiveStashActionState({ selectedCount: 1, busy: false, isDirty: true }).label, "Stash selected file");

console.log("Selective file stash UI state tests ok");
