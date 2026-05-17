import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { CacheService } from "../electron/main/cache-service.js";
import { DatabaseService } from "../electron/main/database-service.js";
import { LocalGitService } from "../electron/main/local-git-service.js";
import { SettingsService } from "../electron/main/settings-service.js";
import { WorkspaceService } from "../electron/main/workspace-service.js";
import { operationRecoveryCopy, operationReport } from "../src/renderer/components/OperationStatusPanel.js";
import { createOperationServiceFixture, insertWatchedRepoFixture } from "./helpers/operation-record-fixtures.js";

const execFileAsync = promisify(execFile);

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-recovery-records-test-"));
const settings = new SettingsService();
settings.update({ workspacePath: tempDir });
const database = new DatabaseService(settings.databasePath());
const workspace = new WorkspaceService(() => settings.get());
const cache = new CacheService(database, settings, workspace);
const repoPath = path.join(tempDir, "repo");

try {
  await git(tempDir, ["init", "-b", "main", "repo"]);
  await git(repoPath, ["config", "user.email", "local@example.com"]);
  await git(repoPath, ["config", "user.name", "Local User"]);
  await writeFile(path.join(repoPath, "README.md"), "hello\n");
  await git(repoPath, ["add", "README.md"]);
  await git(repoPath, ["commit", "-m", "initial"]);
  await writeFile(path.join(repoPath, "notes.txt"), "private file contents\n");
  await git(repoPath, ["stash", "push", "-u", "-m", "existing stash"]);
  await writeFile(path.join(repoPath, "README.md"), "hello\nrecovery\n");

  insertWatchedRepoFixture(database, {
    id: "secret-repo",
    fullName: "secret-org/repo",
    workspacePath: tempDir,
    localPath: repoPath
  });

  const localGit = new LocalGitService(database);
  const operations = createOperationServiceFixture(database);
  await operations.run({
    repoId: "secret-repo",
    kind: "discard_file",
    riskLevel: "destructive",
    commandSummary: "Discard README.md",
    redactedCommand: "git restore/clean -- <path:README.md>",
    preflight: (context) =>
      localGit.recoverySnapshot("secret-repo", {
        operationId: context.operationId,
        operationKind: "discard_file",
        createSafetyRef: true
      }),
    execute: () => localGit.discardFile("secret-repo", "README.md")
  });

  const operation = database.localCache.operationRecords.listRecent("secret-repo")[0];
  assert.equal(operation.status, "succeeded");
  assert.equal(operation.recoveryBranch, "main");
  assert.equal(operation.recoveryIsDirty, true);
  assert.equal(operation.recoveryFileCount, 1);
  assert.deepEqual(operation.recoveryStashRefs, ["stash@{0}"]);
  assert.match(operation.recoveryReflogHint ?? "", /git reflog/);
  assert.match(operation.recoveryHint ?? "", /Before this operation, HEAD was/);
  assert.match(operation.recoveryHint ?? "", /A safety ref was created at refs\/fallback\/operations\/discard_file\//);
  assert.ok(operation.recoveryRef);
  await git(repoPath, ["show-ref", "--verify", operation.recoveryRef]);

  const recoveryCopy = operationRecoveryCopy(operation);
  assert.match(recoveryCopy ?? "", /Before this operation, HEAD was/);
  assert.match(recoveryCopy ?? "", /worktree was dirty with 1 changed files/);
  assert.match(operationReport(operation), /Recovery safety ref: refs\/fallback\/operations\/discard_file\//);

  const redacted = cache.exportDiagnostics();
  const redactedBody = await readFile(redacted.path, "utf8");
  assert.match(redactedBody, /"recoveryRecords"/);
  assert.doesNotMatch(redactedBody, /secret-org\/repo/);
  assert.doesNotMatch(redactedBody, /private file contents/);
  assert.match(redactedBody, /"repoFullName": "repo-1"/);
  assert.match(redactedBody, /"recoveryRef": "refs\/fallback\/operations\/discard_file\//);

  const sensitive = cache.exportDiagnostics(true);
  const sensitiveBody = await readFile(sensitive.path, "utf8");
  assert.match(sensitiveBody, /secret-org\/repo/);
  assert.doesNotMatch(sensitiveBody, /private file contents/);

  console.log("Recovery records tests ok");
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}
