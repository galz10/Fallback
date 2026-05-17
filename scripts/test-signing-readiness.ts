import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseService } from "../electron/main/database-service.js";
import { IdentityService } from "../electron/main/identity-service.js";
import { SettingsService } from "../electron/main/settings-service.js";
import { SigningReadinessService } from "../electron/main/signing-readiness-service.js";
import { GitHubApiError } from "../electron/main/github-client.js";

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-signing-readiness-test-"));
const settings = new SettingsService();
settings.update({ workspacePath: tempDir });
const database = new DatabaseService(settings.databasePath());
const repoPath = path.join(tempDir, "repo");
const repoId = "github.com/octo/repo";

try {
  await git(tempDir, ["init", "-b", "main", "repo"]);
  await git(repoPath, ["config", "user.name", "Mona"]);
  await git(repoPath, ["config", "user.email", "mona@example.com"]);
  await git(repoPath, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(repoPath, "README.md"), "hello\n");
  await git(repoPath, ["add", "README.md"]);
  await git(repoPath, ["commit", "-m", "Initial"]);

  database.db
    .prepare(
      `INSERT INTO repos (
         id, github_repo_id, owner, name, full_name, default_branch, is_private, is_fork, watch_enabled, local_path, sync_status, created_at, updated_at
       )
       VALUES (?, 1, 'octo', 'repo', 'octo/repo', 'main', 0, 0, 1, ?, 'idle', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    .run(repoId, repoPath);
  database.localCache.repoIdentities.upsertRepoIdentity(repoId, {
    gitName: "Mona",
    gitEmail: "mona@example.com",
    signingMode: "ssh",
    signingKeyHint: path.join(tempDir, "missing.pub")
  });

  const identity = new IdentityService(database);
  const github = {
    get: async (route: string) => {
      if (route === "/user/ssh_signing_keys") return [];
      if (route === "/user/gpg_keys") return [];
      throw new GitHubApiError(404, "Not Found", "Not Found");
    }
  };
  const readinessService = new SigningReadinessService(database, github as never, identity);
  const readiness = await readinessService.readiness(repoId);
  assert.equal(readiness.enforcement, "repo_policy");
  assert.equal(readiness.expectedMode, "ssh");
  assert.equal(readiness.satisfiesPolicy, false);
  assert.match(readiness.requirement.detail, /requires SSH signed commits/);
  assert.ok(readiness.checks.some((check) => /SSH signing key not configured/.test(check.summary)));

  const sshKeyPath = path.join(tempDir, "id_ed25519.pub");
  await writeFile(sshKeyPath, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINotUploaded test@example.com\n");
  await git(repoPath, ["config", "commit.gpgsign", "true"]);
  await git(repoPath, ["config", "gpg.format", "ssh"]);
  await git(repoPath, ["config", "user.signingkey", sshKeyPath]);
  const uploadReadiness = await readinessService.readiness(repoId);
  assert.equal(uploadReadiness.githubKeyStatus, "not_uploaded");
  assert.ok(uploadReadiness.checks.some((check) => check.summary === "GitHub signing key not uploaded."));
  assert.equal(JSON.stringify(uploadReadiness).includes("AAAAC3NzaC1lZDI1NTE5AAAAINotUploaded"), false);

  const verification = await readinessService.verify(repoId);
  assert.equal(verification.status, "failed");
  assert.match(verification.redactedCommand ?? "", /commit-tree -S/);

  console.log("Signing readiness tests ok");
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}
