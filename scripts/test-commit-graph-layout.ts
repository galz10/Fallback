import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { layoutCommitGraph } from "../src/shared/commit-graph-layout.js";

const linear = layoutCommitGraph([
  { sha: "c", parentShas: ["b"] },
  { sha: "b", parentShas: ["a"] },
  { sha: "a", parentShas: [] }
]);
assert.deepEqual(
  linear.rows.map((row) => row.lane),
  [0, 0, 0]
);
assert.equal(linear.maxLane, 0);

const branch = layoutCommitGraph([
  { sha: "d", parentShas: ["b", "c"] },
  { sha: "c", parentShas: ["a"] },
  { sha: "b", parentShas: ["a"] },
  { sha: "a", parentShas: [] }
]);
assert.equal(branch.rows[0].lane, 0);
assert.deepEqual(
  branch.rows[0].edges.map((edge) => [edge.fromLane, edge.toLane, edge.status]),
  [
    [0, 0, "loaded"],
    [0, 1, "loaded"]
  ]
);
assert.equal(branch.maxLane, 1);

const octopus = layoutCommitGraph([
  { sha: "m", parentShas: ["a", "b", "c"] },
  { sha: "c", parentShas: [] },
  { sha: "b", parentShas: [] },
  { sha: "a", parentShas: [] }
]);
assert.equal(octopus.rows[0].edges.length, 3);
assert.equal(octopus.maxLane, 2);

const detachedHead = layoutCommitGraph([
  { sha: "detached", parentShas: ["base"] },
  { sha: "base", parentShas: [] }
]);
assert.deepEqual(
  detachedHead.rows.map((row) => row.lane),
  [0, 0]
);

const missingParent = layoutCommitGraph([{ sha: "tip", parentShas: ["outside-cap"] }]);
assert.equal(missingParent.rows[0].edges[0].status, "missing");
assert.equal(missingParent.rows[0].edges[0].parentSha, "outside-cap");

const fixture = Array.from({ length: 300 }, (_value, index) => ({
  sha: `commit-${index}`,
  parentShas: index === 299 ? [] : [`commit-${index + 1}`]
}));
const startedAt = performance.now();
layoutCommitGraph(fixture);
const durationMs = performance.now() - startedAt;
assert.ok(durationMs < 50, `layout should stay under 50ms for 300 commits, got ${durationMs.toFixed(2)}ms`);

console.log("Commit graph layout tests ok");
