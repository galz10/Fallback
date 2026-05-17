import assert from "node:assert/strict";
import {
  buildChangedFileTree,
  changedFileGitStatus,
  changedFileTreePaths,
  filterLocalChangeFiles
} from "../src/shared/local-changes-tree.js";
import type { LocalChangeFile } from "../src/shared/domain/local-git.js";

const files: LocalChangeFile[] = [
  change("src/app/main.tsx", "modified", true, true),
  change("src/app/App.test.ts", "added", true, false),
  change("src/old/Button.tsx", "renamed", false, true, "src/components/Button.tsx"),
  change("README.md", "untracked", false, true),
  change("docs/setup.md", "deleted", true, false)
];

assert.deepEqual(
  filterLocalChangeFiles(files, { query: "src/", status: "all", stage: "all" }).map((file) => file.path),
  ["src/app/main.tsx", "src/app/App.test.ts", "src/old/Button.tsx"]
);
assert.deepEqual(
  filterLocalChangeFiles(files, { query: "components", status: "renamed", stage: "unstaged" }).map((file) => file.path),
  ["src/old/Button.tsx"]
);
assert.deepEqual(
  filterLocalChangeFiles(files, { query: "", status: "all", stage: "staged" }).map((file) => file.path),
  ["src/app/main.tsx", "src/app/App.test.ts", "docs/setup.md"]
);
assert.deepEqual(
  filterLocalChangeFiles(files, { query: "", status: "tracked", stage: "all" }).map((file) => file.path),
  ["src/app/main.tsx", "src/app/App.test.ts", "src/old/Button.tsx", "docs/setup.md"]
);

const tree = buildChangedFileTree(files);
assert.equal(tree[0]?.name, "(root)");
const src = tree.find((node) => node.name === "src");
assert.ok(src);
assert.equal(src.fileCount, 3);
assert.deepEqual(
  src.children.map((node) => node.name),
  ["app", "old"]
);
assert.equal(src.children.find((node) => node.name === "app")?.fileCount, 2);

assert.deepEqual(changedFileTreePaths(files), [
  "docs/setup.md",
  "README.md",
  "src/app/App.test.ts",
  "src/app/main.tsx",
  "src/old/Button.tsx"
]);
assert.deepEqual(changedFileGitStatus([change("copied.ts", "copied", true, false)]), [{ path: "copied.ts", status: "modified" }]);

const manyFiles = Array.from({ length: 10_000 }, (_value, index) =>
  change(`packages/pkg-${index % 100}/src/file-${index}.ts`, "modified", false, true)
);
const start = performance.now();
const filtered = filterLocalChangeFiles(manyFiles, { query: "pkg-42", status: "modified", stage: "unstaged" });
const paths = changedFileTreePaths(filtered);
const largeTree = buildChangedFileTree(filtered);
const duration = performance.now() - start;
assert.equal(filtered.length, 100);
assert.equal(paths.length, 100);
assert.ok(largeTree.length > 0);
assert.ok(duration < 500, `expected 10k-file filtering/tree prep under 500ms, got ${duration.toFixed(1)}ms`);

console.log("Local changes tree helper tests ok");

function change(
  path: string,
  status: LocalChangeFile["status"],
  staged: boolean,
  unstaged: boolean,
  previousPath: string | null = null
): LocalChangeFile {
  return {
    path,
    previousPath,
    status,
    staged,
    unstaged,
    additions: 1,
    deletions: status === "deleted" ? 1 : 0
  };
}
