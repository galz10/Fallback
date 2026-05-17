import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseService } from "../electron/main/database-service.js";
import { RepoWorkspaceService } from "../electron/main/repo-workspace-service.js";

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-workspaces-test-"));
const repoPath = path.join(tempDir, "repo");
const database = new DatabaseService(path.join(tempDir, "fallback.sqlite"));
const service = new RepoWorkspaceService(database);

try {
  await git(tempDir, ["init", "-b", "main", repoPath]);
  await git(repoPath, ["config", "user.name", "Fallback Test"]);
  await git(repoPath, ["config", "user.email", "fallback-test@example.com"]);
  await writeFile(path.join(repoPath, "README.md"), "hello\n");
  await git(repoPath, ["add", "README.md"]);
  await git(repoPath, ["commit", "-m", "initial"]);

  insertRepo(database, repoPath);

  const initial = await service.refresh("octo-repo");
  assert.equal(initial.length, 1);
  assert.equal(initial[0]?.kind, "clone");
  assert.equal(initial[0]?.isActive, true);
  assert.equal(initial[0]?.branch, "main");
  assert.equal(initial[0]?.isDirty, false);

  const created = await service.create("octo-repo", {
    branchName: "feature/workspaces",
    baseRef: "main",
    createBranch: true
  });
  assert.equal(created.kind, "worktree");
  assert.equal(created.branch, "feature/workspaces");
  assert.equal(database.localCache.repos.getRepo("octo-repo")?.localPath, created.localPath);

  await writeFile(path.join(created.localPath, "dirty.txt"), "dirty\n");
  const dirty = (await service.refresh("octo-repo")).find((workspace) => workspace.id === created.id);
  assert.equal(dirty?.isDirty, true);

  const clean = await service.create("octo-repo", {
    branchName: "feature/clean",
    baseRef: "main",
    createBranch: true
  });
  assert.equal(clean.isDirty, false);

  const locked = await service.create("octo-repo", {
    branchName: "feature/locked",
    baseRef: "main",
    createBranch: true
  });
  await git(repoPath, ["worktree", "lock", "--reason", "reserved for review", locked.localPath]);
  const lockedAfterRefresh = (await service.refresh("octo-repo")).find((workspace) => workspace.id === locked.id);
  assert.equal(lockedAfterRefresh?.locked, true);
  assert.equal(lockedAfterRefresh?.lockReason, "reserved for review");

  const clone = database.localCache.repoWorkspaces.listRepoWorkspaces("octo-repo").find((workspace) => workspace.kind === "clone");
  assert.ok(clone);

  const stale = await service.create("octo-repo", {
    branchName: "feature/stale",
    baseRef: "main",
    createBranch: true
  });
  await service.switch("octo-repo", clone.id);
  await rm(stale.localPath, { force: true, recursive: true });
  const staleAfterRefresh = (await service.refresh("octo-repo")).find((workspace) => workspace.id === stale.id);
  assert.equal(staleAfterRefresh?.missing, true);
  assert.equal(staleAfterRefresh?.prunable, true);

  await service.switch("octo-repo", clone.id);
  await assert.rejects(service.remove("octo-repo", created.id), /local changes/);
  await assert.rejects(service.remove("octo-repo", locked.id), /locked/);

  const afterRemove = await service.remove("octo-repo", created.id, { force: true });
  assert.equal(
    afterRemove.some((workspace) => workspace.id === created.id),
    false
  );
  await service.remove("octo-repo", clean.id);
  await git(repoPath, ["worktree", "unlock", locked.localPath]);
  await service.refresh("octo-repo");
  await service.remove("octo-repo", locked.id);

  const afterPrune = await service.prune("octo-repo");
  assert.equal(afterPrune.length, 1);

  console.log("Repo workspace service tests ok");
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return stdout;
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
