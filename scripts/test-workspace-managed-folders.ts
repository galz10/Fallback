import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { CacheService } from "../electron/main/cache-service.js";
import { DatabaseService } from "../electron/main/database-service.js";
import { SettingsService } from "../electron/main/settings-service.js";
import { WorkspaceService } from "../electron/main/workspace-service.js";
import { insertWatchedRepoFixture } from "./helpers/operation-record-fixtures.js";

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-managed-folders-test-"));
const settings = new SettingsService();
settings.update({ workspacePath: tempDir });
const workspace = new WorkspaceService(() => settings.get());
const database = new DatabaseService(settings.databasePath());
const cache = new CacheService(database, settings, workspace);

try {
  const account = database.localCache.accounts.upsertGitHubAccount({
    id: "42",
    login: "mona",
    avatarUrl: null,
    endpoint: "https://api.github.com",
    htmlUrl: "https://github.com/mona",
    tokenSource: "keychain",
    tokenScopes: ["repo"],
    authStatus: "connected"
  });
  database.localCache.accounts.setActiveGitHubAccount(account.id);

  const managedCurrent = workspace.ensureRepoFolder("octo", "repo", "cloned");
  await writeFile(path.join(managedCurrent, "managed.txt"), "managed\n");
  insertWatchedRepoFixture(database, {
    id: "github.com/octo/repo",
    githubRepoId: 1,
    owner: "octo",
    name: "repo",
    fullName: "octo/repo",
    localPath: managedCurrent
  });

  const legacyPath = path.join(tempDir, "github.com", "legacy", "repo");
  await mkdir(path.join(legacyPath, ".git"), { recursive: true });
  await writeFile(path.join(legacyPath, "legacy.txt"), "legacy\n");
  insertWatchedRepoFixture(database, {
    id: "github.com/legacy/repo",
    githubRepoId: 2,
    owner: "legacy",
    name: "repo",
    fullName: "legacy/repo",
    localPath: legacyPath
  });

  const unmanagedPath = path.join(tempDir, "danger", "repo");
  await mkdir(unmanagedPath, { recursive: true });
  await writeFile(path.join(unmanagedPath, "do-not-delete.txt"), "user data\n");
  insertWatchedRepoFixture(database, {
    id: "github.com/danger/repo",
    githubRepoId: 3,
    owner: "danger",
    name: "repo",
    fullName: "danger/repo",
    localPath: unmanagedPath,
    watchMode: "metadata-only",
    cloneEnabled: false,
    cloneStatus: null
  });

  const unrelatedPath = path.join(tempDir, "unrelated", "notes");
  await mkdir(unrelatedPath, { recursive: true });
  await writeFile(path.join(unrelatedPath, "keep.txt"), "keep\n");

  cache.deleteAll();
  assert.equal(existsSync(managedCurrent), false, "expected current managed repo folder to be removed");
  assert.equal(existsSync(legacyPath), false, "expected legacy managed repo folder to be removed");
  assert.equal(await readFile(path.join(unmanagedPath, "do-not-delete.txt"), "utf8"), "user data\n");
  assert.equal(await readFile(path.join(unrelatedPath, "keep.txt"), "utf8"), "keep\n");
  assert.equal(database.localCache.repos.listWatchedRepos().length, 0);
  assert.equal(database.localCache.accounts.getGitHubAccountById(account.id)?.login, "mona");
  assert.equal(database.localCache.accounts.getGitHubAccount()?.id, account.id);

  await assertCloneSafety(tempDir);

  console.log("Workspace managed folder tests ok");
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}

async function assertCloneSafety(parentDir: string): Promise<void> {
  const remotePath = path.join(parentDir, "remote.git");
  const seedPath = path.join(parentDir, "seed");
  await git(parentDir, ["init", "--bare", remotePath]);
  await git(parentDir, ["init", "-b", "main", seedPath]);
  await git(seedPath, ["config", "user.email", "fallback@example.com"]);
  await git(seedPath, ["config", "user.name", "Fallback"]);
  await writeFile(path.join(seedPath, "README.md"), "hello\n");
  await git(seedPath, ["add", "README.md"]);
  await git(seedPath, ["commit", "-m", "initial"]);
  await git(seedPath, ["remote", "add", "origin", remotePath]);
  await git(seedPath, ["push", "-u", "origin", "main"]);

  const unsafeWorkspacePath = path.join(parentDir, "unsafe-workspace");
  const unsafeService = new WorkspaceService(() => ({ ...settings.get(), workspacePath: unsafeWorkspacePath }));
  const unsafeTarget = path.join(unsafeWorkspacePath, "octo", "repo");
  await mkdir(unsafeTarget, { recursive: true });
  await writeFile(path.join(unsafeTarget, "user.txt"), "do not delete\n");
  unsafeService.ensureRepoFolder("octo", "repo", "cloned");
  await assert.rejects(unsafeService.ensureRepoClone("octo", "repo", remotePath, "main"), /not managed by Fallback/);
  assert.equal(await readFile(path.join(unsafeTarget, "user.txt"), "utf8"), "do not delete\n");

  const emptyWorkspacePath = path.join(parentDir, "empty-workspace");
  const emptyService = new WorkspaceService(() => ({ ...settings.get(), workspacePath: emptyWorkspacePath }));
  const emptyTarget = path.join(emptyWorkspacePath, "octo", "repo");
  await mkdir(emptyTarget, { recursive: true });
  const emptyClone = await emptyService.ensureRepoClone("octo", "repo", remotePath, "main");
  assert.equal(emptyClone, emptyTarget);
  assert.equal(existsSync(path.join(emptyClone, ".git")), true);

  const existingGitWorkspacePath = path.join(parentDir, "existing-git-workspace");
  const existingGitService = new WorkspaceService(() => ({ ...settings.get(), workspacePath: existingGitWorkspacePath }));
  const existingGitTarget = path.join(existingGitWorkspacePath, "octo", "repo");
  await mkdir(path.dirname(existingGitTarget), { recursive: true });
  await git(parentDir, ["clone", "--quiet", remotePath, existingGitTarget]);
  await writeFile(path.join(existingGitTarget, "keep-local.txt"), "keep local\n");
  const existingGitClone = await existingGitService.ensureRepoClone("octo", "repo", remotePath, "main");
  assert.equal(existingGitClone, existingGitTarget);
  assert.equal(await readFile(path.join(existingGitTarget, "keep-local.txt"), "utf8"), "keep local\n");
  assert.equal(existsSync(path.join(existingGitTarget, ".git")), true);

  const managedWorkspacePath = path.join(parentDir, "managed-workspace");
  const managedService = new WorkspaceService(() => ({ ...settings.get(), workspacePath: managedWorkspacePath }));
  const managedTarget = managedService.ensureRepoFolder("octo", "repo", "cloned");
  await writeFile(path.join(managedTarget, "placeholder.txt"), "replace me\n");
  const managedClone = await managedService.ensureRepoClone("octo", "repo", remotePath, "main");
  assert.equal(managedClone, managedTarget);
  assert.equal(existsSync(path.join(managedClone, ".git")), true);
  assert.equal(existsSync(path.join(managedClone, "placeholder.txt")), false);
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}
