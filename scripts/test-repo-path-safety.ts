import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectRepoPath } from "../electron/main/repo-path-safety.js";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-repo-path-safety-test-"));
const repoPath = path.join(tempDir, "repo");
const outsidePath = path.join(tempDir, "outside.txt");

try {
  await mkdir(repoPath, { recursive: true });
  await writeFile(path.join(repoPath, "inside.txt"), "inside\n");
  await writeFile(outsidePath, "outside secret\n");
  await symlink(outsidePath, path.join(repoPath, "outside-link.txt"));

  const file = inspectRepoPath(repoPath, "inside.txt");
  assert.equal(file.kind, "file");
  assert.equal(file.kind === "file" ? await readFile(file.absolutePath, "utf8") : "", "inside\n");

  const link = inspectRepoPath(repoPath, "outside-link.txt");
  assert.equal(link.kind, "symlink");

  const escaped = inspectRepoPath(repoPath, "../outside.txt");
  assert.equal(escaped.kind, "outside");

  console.log("Repo path safety tests ok");
} finally {
  await rm(tempDir, { force: true, recursive: true });
}
