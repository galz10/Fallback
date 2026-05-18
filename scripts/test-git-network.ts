import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseService } from "../electron/main/database-service.js";
import { LocalGitNetworkError, LocalGitService } from "../electron/main/local-git-service.js";

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-git-network-test-"));
const remotePath = path.join(tempDir, "remote.git");
const seedPath = path.join(tempDir, "seed");
const appPath = path.join(tempDir, "app");
const database = new DatabaseService(path.join(tempDir, "fallback.sqlite"));
const service = new LocalGitService(database);

try {
  await git(tempDir, ["init", "--bare", remotePath]);
  await git(tempDir, ["init", "-b", "main", seedPath]);
  await configureUser(seedPath);
  await writeFile(path.join(seedPath, "README.md"), "hello\n");
  await git(seedPath, ["add", "README.md"]);
  await git(seedPath, ["commit", "-m", "initial"]);
  await git(seedPath, ["remote", "add", "origin", remotePath]);
  await git(seedPath, ["push", "-u", "origin", "main"]);
  await git(remotePath, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(tempDir, ["-c", "core.autocrlf=false", "-c", "core.eol=lf", "clone", remotePath, appPath]);
  await configureUser(appPath);
  insertRepo(database, appPath, remotePath);

  const initial = await service.gitNetworkPreflight("octo-repo");
  assert.equal(initial.branch, "main");
  assert.equal(initial.upstream, "origin/main");
  assert.equal(initial.remoteProtocol, "file");
  assert.equal(initial.status, "up_to_date");

  await commitFile(seedPath, "remote.txt", "remote one\n", "remote update");
  await git(seedPath, ["push"]);
  const fetchResult = await service.fetchWorkspace("octo-repo");
  assert.equal(fetchResult.action, "fetch");
  assert.equal((await service.gitNetworkPreflight("octo-repo")).behind, 1);

  const pullResult = await service.pullWorkspace("octo-repo", { strategy: "ff-only" });
  assert.equal(pullResult.action, "pull");
  assert.equal((await service.gitNetworkPreflight("octo-repo")).status, "up_to_date");
  assert.equal(await readFile(path.join(appPath, "remote.txt"), "utf8"), "remote one\n");

  await commitFile(appPath, "local.txt", "local one\n", "local update");
  assert.equal((await service.gitNetworkPreflight("octo-repo")).ahead, 1);
  const pushResult = await service.pushWorkspace("octo-repo");
  assert.equal(pushResult.action, "push");
  await git(seedPath, ["fetch", "origin", "main"]);
  assert.equal(await git(appPath, ["rev-parse", "HEAD"]), await git(seedPath, ["rev-parse", "origin/main"]));

  await git(appPath, ["checkout", "-b", "feature/publish"]);
  await commitFile(appPath, "feature.txt", "published\n", "publish branch");
  const publishResult = await service.publishWorkspace("octo-repo");
  assert.equal(publishResult.action, "publish");
  assert.equal(await git(appPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]), "origin/feature/publish");
  await assert.rejects(service.publishWorkspace("octo-repo", { remote: "https://example.com/octo/repo.git" }), /configured remote name/);
  await assert.rejects(service.publishWorkspace("octo-repo", { remote: "--mirror" }), /must not start/);
  await assert.rejects(service.publishWorkspace("octo-repo", { branchName: "--delete" }), /must not start/);
  await assert.rejects(service.publishWorkspace("octo-repo", { branchName: "bad branch" }), /invalid Git ref/);

  await git(appPath, ["checkout", "main"]);
  await git(seedPath, ["checkout", "main"]);
  await git(seedPath, ["reset", "--hard", "origin/main"]);
  await commitFile(seedPath, "merge-remote.txt", "remote merge\n", "remote merge side");
  await git(seedPath, ["push"]);
  await commitFile(appPath, "merge-local.txt", "local merge\n", "local merge side");
  await service.fetchWorkspace("octo-repo");
  assert.equal((await service.gitNetworkPreflight("octo-repo")).status, "diverged");
  await service.pullWorkspace("octo-repo", { strategy: "merge" });
  assert.equal((await git(appPath, ["rev-list", "--parents", "-n", "1", "HEAD"])).split(/\s+/).length, 3);

  await service.pushWorkspace("octo-repo");
  await git(seedPath, ["fetch", "origin", "main"]);
  await git(seedPath, ["reset", "--hard", "origin/main"]);
  await commitFile(seedPath, "reject-remote.txt", "remote reject\n", "remote reject side");
  await git(seedPath, ["push"]);
  await commitFile(appPath, "reject-local.txt", "local reject\n", "local reject side");
  await assert.rejects(service.pushWorkspace("octo-repo"), (error) => {
    assert.ok(error instanceof LocalGitNetworkError);
    assert.equal(error.status, "non_fast_forward");
    return true;
  });

  console.log("Git network service tests ok");
} finally {
  database.close();
  service.dispose();
  await rm(tempDir, { force: true, recursive: true });
}

async function configureUser(cwd: string): Promise<void> {
  await git(cwd, ["config", "user.name", "Fallback Test"]);
  await git(cwd, ["config", "user.email", "fallback-test@example.com"]);
  await git(cwd, ["config", "core.autocrlf", "false"]);
  await git(cwd, ["config", "core.eol", "lf"]);
}

async function commitFile(cwd: string, name: string, contents: string, message: string): Promise<void> {
  await mkdir(path.dirname(path.join(cwd, name)), { recursive: true });
  await writeFile(path.join(cwd, name), contents);
  await git(cwd, ["add", name]);
  await git(cwd, ["commit", "-m", message]);
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return stdout.trim();
}

function insertRepo(db: DatabaseService, localPath: string, remotePath: string): void {
  db.db
    .prepare(
      `INSERT INTO repos (
        id, github_repo_id, owner, name, full_name, is_private, default_branch, html_url,
        workspace_path, local_path, watch_mode, clone_enabled, clone_status, watch_enabled,
        sync_status, created_at, updated_at
      )
      VALUES ('octo-repo', 1, 'octo', 'repo', 'octo/repo', 0, 'main', ?,
        ?, ?, 'cloned', 1, 'cloned', 1, 'fresh', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run(remotePath, localPath, localPath);
}
