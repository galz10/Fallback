import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseService } from "../electron/main/database-service.js";
import { LocalGitService } from "../electron/main/local-git-service.js";
import { createOperationServiceFixture, insertWatchedRepoFixture } from "./helpers/operation-record-fixtures.js";

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-selective-stash-test-"));
const repoPath = path.join(tempDir, "repo");
const database = new DatabaseService(path.join(tempDir, "fallback.sqlite"));

try {
  await git(tempDir, ["init", "-b", "main", "repo"]);
  await git(repoPath, ["config", "user.email", "local@example.com"]);
  await git(repoPath, ["config", "user.name", "Local User"]);
  await writeFile(path.join(repoPath, "tracked-a.txt"), "base a\n");
  await writeFile(path.join(repoPath, "tracked-b.txt"), "base b\n");
  await git(repoPath, ["add", "."]);
  await git(repoPath, ["commit", "-m", "initial"]);

  insertWatchedRepoFixture(database, { id: "octo-repo", workspacePath: tempDir, localPath: repoPath });

  const localGit = new LocalGitService(database);
  const operations = createOperationServiceFixture(database);

  await writeFile(path.join(repoPath, "tracked-a.txt"), "selected change\n");
  await writeFile(path.join(repoPath, "tracked-b.txt"), "unselected change\n");
  const trackedResult = await operations.run({
    repoId: "octo-repo",
    kind: "stash_files",
    riskLevel: "normal",
    commandSummary: "Stash selected tracked file",
    redactedCommand: "git stash push -u -m <message> -- <paths>",
    preflight: (context) =>
      localGit.recoverySnapshot("octo-repo", {
        operationId: context.operationId,
        operationKind: "stash_files",
        createSafetyRef: true
      }),
    execute: () => localGit.stashFiles("octo-repo", ["tracked-a.txt"], "selected tracked"),
    postflight: (result) =>
      result.createdStashRef
        ? { resultSummary: `Created stash ${result.createdStashRef}.`, resultStashRefs: [result.createdStashRef] }
        : null
  });
  assert.equal(trackedResult.createdStashRef, "stash@{0}");
  assert.equal(readFileSync(path.join(repoPath, "tracked-a.txt"), "utf8"), "base a\n");
  assert.equal(readFileSync(path.join(repoPath, "tracked-b.txt"), "utf8"), "unselected change\n");
  assert.equal(
    trackedResult.files.some((file) => file.path === "tracked-a.txt"),
    false
  );
  assert.equal(
    trackedResult.files.some((file) => file.path === "tracked-b.txt"),
    true
  );
  const trackedDetail = await localGit.stashDetail("octo-repo", "stash@{0}");
  assert.deepEqual(
    trackedDetail.files.map((file) => file.path),
    ["tracked-a.txt"]
  );
  const operation = database.localCache.operationRecords.listRecent("octo-repo").find((record) => record.kind === "stash_files");
  assert.deepEqual(operation?.resultStashRefs, ["stash@{0}"]);
  assert.match(operation?.resultSummary ?? "", /Created stash stash@\{0\}/);

  await git(repoPath, ["reset", "--hard", "HEAD"]);
  await git(repoPath, ["clean", "-fd"]);
  await mkdir(path.join(repoPath, "notes"), { recursive: true });
  await writeFile(path.join(repoPath, "notes", "selected.md"), "selected untracked\n");
  await writeFile(path.join(repoPath, "notes", "keep.md"), "keep untracked\n");
  const untrackedResult = await localGit.stashFiles("octo-repo", ["notes/selected.md"], "selected untracked");
  assert.equal(untrackedResult.createdStashRef, "stash@{0}");
  assert.equal(existsSync(path.join(repoPath, "notes", "selected.md")), false);
  assert.equal(existsSync(path.join(repoPath, "notes", "keep.md")), true);
  const untrackedDetail = await localGit.stashDetail("octo-repo", "stash@{0}");
  assert.deepEqual(
    untrackedDetail.files.map((file) => file.path),
    ["notes/selected.md"]
  );
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

console.log("Selective file stash tests ok");
