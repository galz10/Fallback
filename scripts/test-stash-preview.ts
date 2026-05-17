import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseService } from "../electron/main/database-service.js";
import { LocalGitService } from "../electron/main/local-git-service.js";

const execFileAsync = promisify(execFile);

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-stash-preview-test-"));
const repoPath = path.join(tempDir, "repo");
const databasePath = path.join(tempDir, "fallback.sqlite");
const database = new DatabaseService(databasePath);

try {
  await git(tempDir, ["init", "-b", "main", "repo"]);
  await git(repoPath, ["config", "user.email", "local@example.com"]);
  await git(repoPath, ["config", "user.name", "Local User"]);
  await writeFile(path.join(repoPath, "README.md"), "base\n");
  await git(repoPath, ["add", "README.md"]);
  await git(repoPath, ["commit", "-m", "initial"]);
  await git(repoPath, ["checkout", "-b", "feature"]);
  await writeFile(path.join(repoPath, "feature.txt"), "feature stash\n");
  await git(repoPath, ["stash", "push", "-u", "-m", "feature stash"]);
  await git(repoPath, ["checkout", "main"]);

  database.db
    .prepare(
      `INSERT INTO repos (
        id, github_repo_id, owner, name, full_name, is_private, default_branch, html_url,
        workspace_path, local_path, watch_mode, clone_enabled, clone_status, watch_enabled,
        sync_status, created_at, updated_at
      )
      VALUES ('octo-repo', 1, 'octo', 'repo', 'octo/repo', 0, 'main', 'https://github.com/octo/repo',
        ?, ?, 'cloned', 1, 'cloned', 1, 'fresh', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run(tempDir, repoPath);

  const localGit = new LocalGitService(database);
  const detail = await localGit.stashDetail("octo-repo", "stash@{0}");
  assert.equal(detail.branch, "feature");
  assert.equal(detail.message, "feature stash");
  assert.equal(detail.files.length, 1);
  assert.equal(detail.files[0]?.path, "feature.txt");
  assert.equal(detail.files[0]?.status, "added");
  assert.match(detail.patch, /feature stash/);
  assert.ok(detail.baseSha);
  assert.equal(detail.baseMessage, "initial");

  await writeFile(path.join(repoPath, "README.md"), "dirty main\n");
  await localGit.applyStash("octo-repo", "stash@{0}");
  const stashesAfterCrossBranchApply = await localGit.changes("octo-repo");
  assert.equal(stashesAfterCrossBranchApply.stashes.length, 2);
  assert.match(stashesAfterCrossBranchApply.stashes[0]?.message ?? "", /Fallback safety before applying stash@\{0\} from feature/);
  assert.equal(existsSync(path.join(repoPath, "feature.txt")), true);
  assert.equal(readFileSync(path.join(repoPath, "README.md"), "utf8"), "base\n");

  await git(repoPath, ["reset", "--hard", "HEAD"]);
  await git(repoPath, ["clean", "-fd"]);
  await git(repoPath, ["stash", "drop", "stash@{0}"]);
  await git(repoPath, ["stash", "drop", "stash@{0}"]);
  await writeFile(path.join(repoPath, "main-stash.txt"), "main stash\n");
  await git(repoPath, ["stash", "push", "-u", "-m", "main stash"]);
  await writeFile(path.join(repoPath, "README.md"), "dirty same branch\n");
  await localGit.applyStash("octo-repo", "stash@{0}");
  const stashesAfterSameBranchApply = await localGit.changes("octo-repo");
  assert.equal(stashesAfterSameBranchApply.stashes.length, 1);
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

console.log("Stash preview tests ok");
