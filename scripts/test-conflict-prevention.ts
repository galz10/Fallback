import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseService } from "../electron/main/database-service.js";
import { LocalGitConflictError, LocalGitService } from "../electron/main/local-git-service.js";
import { parseLocalPatch } from "../src/shared/local-diff-patches.js";

const execFileAsync = promisify(execFile);

await withRepo("pull-risk", async ({ repoPath, service }) => {
  await branchCommit(repoPath, "remote", "shared.txt", "remote\n", "remote shared");
  await git(repoPath, ["checkout", "main"]);
  await writeFile(path.join(repoPath, "shared.txt"), "local dirty\n");
  const risk = await service.conflictPreflight("octo-repo", { operation: "pull", targetRef: "remote" });
  assert.equal(risk.riskLevel, "high");
  assert.equal(risk.overlappingFileCount, 1);
  assert.match(risk.summary, /may conflict/);
});

await withRepo("text-conflict", async ({ repoPath, service }) => {
  await branchCommit(repoPath, "side", "shared.txt", "side\n", "side edit");
  await git(repoPath, ["checkout", "main"]);
  await commitFile(repoPath, "shared.txt", "main\n", "main edit");
  await assert.rejects(git(repoPath, ["merge", "side"]));
  const state = await service.conflictState("octo-repo");
  assert.equal(state.state, "merge");
  assert.equal(state.files[0]?.status, "both_modified");
  const patch = await service.changePatch("octo-repo", "shared.txt");
  assert.match(patch.patch, /^diff --git a\/shared\.txt b\/shared\.txt/m);
  assert.match(patch.patch, /<<<<<<< HEAD/);
  assert.match(patch.patch, /=======/);
  assert.match(patch.patch, />>>>>>> side/);
  assert.match(patch.conflictContents ?? "", /<<<<<<< HEAD/);
  assert.ok((patch.conflictMarkerCount ?? 0) >= 3);
  const parsed = parseLocalPatch(patch.patch);
  assert.equal(parsed[0]?.path, "shared.txt");
  assert.ok(parsed[0]?.hunks.length);
  const resolution = await service.resolveConflictFile("octo-repo", { path: "shared.txt", contents: "main\n" });
  assert.equal(resolution.remainingMarkers, false);
  assert.equal(resolution.staged, true);
  assert.equal(resolution.conflictState.fileCount, 0);
  assert.equal(resolution.conflictState.isActive, false);
  assert.equal(await readFile(path.join(repoPath, "shared.txt"), "utf8"), "main\n");
});

await withRepo("rename-delete-conflict", async ({ repoPath, service }) => {
  await git(repoPath, ["checkout", "-b", "rename-side"]);
  await git(repoPath, ["mv", "shared.txt", "renamed.txt"]);
  await git(repoPath, ["commit", "-m", "rename shared"]);
  await git(repoPath, ["checkout", "main"]);
  await git(repoPath, ["rm", "shared.txt"]);
  await git(repoPath, ["commit", "-m", "delete shared"]);
  await assert.rejects(git(repoPath, ["merge", "rename-side"]));
  const state = await service.conflictState("octo-repo");
  assert.ok(state.isActive);
  assert.ok(state.fileCount > 0);
});

await withRepo("binary-conflict", async ({ repoPath, service }) => {
  await branchCommitBuffer(repoPath, "binary-side", "image.bin", Buffer.from([0, 1, 2, 3]), "binary side");
  await git(repoPath, ["checkout", "main"]);
  await commitFileBuffer(repoPath, "image.bin", Buffer.from([0, 9, 8, 7]), "binary main");
  await assert.rejects(git(repoPath, ["merge", "binary-side"]));
  const state = await service.conflictState("octo-repo");
  assert.equal(state.binaryCount, 1);
});

await withRepo("lfs-risk", async ({ repoPath, service }) => {
  const pointerA = "version https://git-lfs.github.com/spec/v1\noid sha256:aaaaaaaa\nsize 1\n";
  const pointerB = "version https://git-lfs.github.com/spec/v1\noid sha256:bbbbbbbb\nsize 1\n";
  await branchCommit(repoPath, "lfs-side", "asset.psd", pointerA, "lfs side");
  await git(repoPath, ["checkout", "main"]);
  await writeFile(path.join(repoPath, "asset.psd"), pointerB);
  const risk = await service.conflictPreflight("octo-repo", { operation: "merge", targetRef: "lfs-side" });
  assert.equal(risk.riskLevel, "high");
  assert.equal(risk.lfsFileCount, 1);
});

await withRepo("stash-conflict", async ({ repoPath, service }) => {
  await writeFile(path.join(repoPath, "shared.txt"), "stashed\n");
  await git(repoPath, ["stash", "push", "-m", "stash conflict"]);
  await writeFile(path.join(repoPath, "shared.txt"), "dirty overlap\n");
  const applyRisk = await service.conflictPreflight("octo-repo", { operation: "stash_apply", stashRef: "stash@{0}" });
  const popRisk = await service.conflictPreflight("octo-repo", { operation: "stash_pop", stashRef: "stash@{0}" });
  assert.equal(applyRisk.overlappingFileCount, 1);
  assert.equal(popRisk.overlappingFileCount, 1);
  assert.deepEqual(
    applyRisk.files.map((file) => file.path),
    ["shared.txt"]
  );
  assert.deepEqual(
    popRisk.files.map((file) => file.path),
    ["shared.txt"]
  );
  await git(repoPath, ["checkout", "--", "shared.txt"]);
  const cleanRisk = await service.conflictPreflight("octo-repo", { operation: "stash_apply", stashRef: "stash@{0}" });
  assert.equal(cleanRisk.riskLevel, "none");
  assert.equal(cleanRisk.overlappingFileCount, 0);
  await commitFile(repoPath, "shared.txt", "committed\n", "conflicting committed edit");
  await assert.rejects(service.applyStash("octo-repo", "stash@{0}"), (error) => {
    assert.ok(error instanceof LocalGitConflictError);
    assert.equal(error.status, "stash_conflict");
    return true;
  });
  assert.equal((await service.conflictState("octo-repo")).isActive, true);
});

await withRepo("stash-moving-ref", async ({ repoPath, service }) => {
  await writeFile(path.join(repoPath, "other.txt"), "older stash\n");
  await git(repoPath, ["stash", "push", "-u", "-m", "older stash"]);
  await writeFile(path.join(repoPath, "shared.txt"), "newer stash\n");
  await git(repoPath, ["stash", "push", "-m", "newer stash"]);
  await writeFile(path.join(repoPath, "shared.txt"), "dirty overlap\n");

  const firstRisk = await service.conflictPreflight("octo-repo", { operation: "stash_apply", stashRef: "stash@{0}" });
  assert.equal(firstRisk.overlappingFileCount, 1);
  assert.deepEqual(
    firstRisk.files.map((file) => file.path),
    ["shared.txt"]
  );

  await git(repoPath, ["stash", "drop", "stash@{0}"]);
  const movedRefRisk = await service.conflictPreflight("octo-repo", { operation: "stash_apply", stashRef: "stash@{0}" });
  assert.equal(movedRefRisk.overlappingFileCount, 0);
  assert.deepEqual(movedRefRisk.files, []);
});

await withRepo("rebase-conflict", async ({ repoPath, service }) => {
  await branchCommit(repoPath, "feature", "shared.txt", "feature\n", "feature edit");
  await git(repoPath, ["checkout", "main"]);
  await commitFile(repoPath, "shared.txt", "main\n", "main edit");
  await git(repoPath, ["checkout", "feature"]);
  await assert.rejects(git(repoPath, ["rebase", "main"]));
  const state = await service.conflictState("octo-repo");
  assert.equal(state.state, "rebase");
  assert.equal(state.isActive, true);
});

await withRepo("cherry-pick-conflict", async ({ repoPath, service }) => {
  await branchCommit(repoPath, "pick", "shared.txt", "pick\n", "pick edit");
  await git(repoPath, ["checkout", "main"]);
  await commitFile(repoPath, "shared.txt", "main\n", "main edit");
  await assert.rejects(git(repoPath, ["cherry-pick", "pick"]));
  const state = await service.conflictState("octo-repo");
  assert.equal(state.state, "cherry_pick");
});

console.log("Conflict prevention and state tests ok");

async function withRepo(
  name: string,
  run: (context: { tempDir: string; repoPath: string; database: DatabaseService; service: LocalGitService }) => Promise<void>
): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), `fallback-conflict-${name}-`));
  const repoPath = path.join(tempDir, "repo");
  const database = new DatabaseService(path.join(tempDir, "fallback.sqlite"));
  const service = new LocalGitService(database);
  try {
    await git(tempDir, ["init", "-b", "main", repoPath]);
    await configureUser(repoPath);
    await commitFile(repoPath, "shared.txt", "base\n", "initial");
    await commitFileBuffer(repoPath, "image.bin", Buffer.from([0, 0, 0, 1]), "binary base");
    insertRepo(database, repoPath);
    await run({ tempDir, repoPath, database, service });
  } finally {
    service.dispose();
    database.close();
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function configureUser(cwd: string): Promise<void> {
  await git(cwd, ["config", "user.name", "Fallback Test"]);
  await git(cwd, ["config", "user.email", "fallback-test@example.com"]);
}

async function branchCommit(cwd: string, branch: string, file: string, contents: string, message: string): Promise<void> {
  await git(cwd, ["checkout", "-b", branch]);
  await commitFile(cwd, file, contents, message);
}

async function branchCommitBuffer(cwd: string, branch: string, file: string, contents: Buffer, message: string): Promise<void> {
  await git(cwd, ["checkout", "-b", branch]);
  await commitFileBuffer(cwd, file, contents, message);
}

async function commitFile(cwd: string, file: string, contents: string, message: string): Promise<void> {
  await writeFile(path.join(cwd, file), contents);
  await git(cwd, ["add", file]);
  await git(cwd, ["commit", "-m", message]);
}

async function commitFileBuffer(cwd: string, file: string, contents: Buffer, message: string): Promise<void> {
  await writeFile(path.join(cwd, file), contents);
  await git(cwd, ["add", file]);
  await git(cwd, ["commit", "-m", message]);
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return stdout.trim();
}

function insertRepo(db: DatabaseService, localPath: string): void {
  db.db
    .prepare(
      `INSERT INTO repos (
        id, github_repo_id, owner, name, full_name, is_private, default_branch, html_url,
        workspace_path, local_path, watch_mode, clone_enabled, clone_status, watch_enabled,
        sync_status, created_at, updated_at
      )
      VALUES ('octo-repo', 1, 'octo', 'repo', 'octo/repo', 0, 'main', 'https://github.com/octo/repo',
        ?, ?, 'cloned', 1, 'cloned', 1, 'fresh', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run(localPath, localPath);
}
