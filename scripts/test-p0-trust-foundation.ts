import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseService } from "../electron/main/database-service.js";
import { IdentityService } from "../electron/main/identity-service.js";
import { LocalGitService } from "../electron/main/local-git-service.js";
import { createOperationServiceFixture, insertWatchedRepoFixture } from "./helpers/operation-record-fixtures.js";

const execFileAsync = promisify(execFile);

const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-p0-trust-test-"));
const repoPath = path.join(tempDir, "repo");
const databasePath = path.join(tempDir, "fallback.sqlite");
const database = new DatabaseService(databasePath);

try {
  await git(tempDir, ["init", "-b", "main", "repo"]);
  await git(repoPath, ["config", "user.email", "local@example.com"]);
  await git(repoPath, ["config", "user.name", "Local User"]);
  await writeFile(path.join(repoPath, "README.md"), "hello\n");
  await git(repoPath, ["add", "README.md"]);
  await git(repoPath, ["commit", "-m", "initial"]);
  await writeFile(path.join(repoPath, "README.md"), "hello\nworld\n");

  insertWatchedRepoFixture(database, { id: "octo-repo", workspacePath: tempDir, localPath: repoPath });
  const account = database.localCache.accounts.upsertGitHubAccount({
    id: "42",
    login: "mona",
    avatarUrl: null,
    name: "Mona",
    tokenScopes: ["repo"]
  });
  const secondAccount = database.localCache.accounts.upsertGitHubAccount({
    id: "99",
    login: "hubot",
    avatarUrl: null,
    name: "Hubot",
    tokenScopes: ["repo"]
  });
  database.localCache.accounts.setActiveGitHubAccount(account.id);

  const identity = new IdentityService(database);
  const initial = await identity.get("octo-repo");
  assert.equal(initial.accountLogin, "mona");
  assert.equal(initial.currentGitEmail, "local@example.com");

  const updated = await identity.update("octo-repo", {
    accountId: secondAccount.id,
    gitName: "Fallback User",
    gitEmail: "fallback@example.com",
    signingMode: "ssh",
    signingKeyHint: "SHA256:test",
    remoteProtocol: "https"
  });
  assert.equal(updated.accountLogin, "hubot");
  assert.equal(updated.currentGitName, "Fallback User");
  assert.equal(updated.currentGitEmail, "fallback@example.com");
  assert.equal(updated.signingMode, "ssh");
  assert.equal(updated.signingKeyHint, "SHA256:test");

  database.localCache.accounts.setActiveGitHubAccount(account.id);
  const afterGlobalSwitch = await identity.get("octo-repo");
  assert.equal(afterGlobalSwitch.accountLogin, "hubot");

  await identity.update("octo-repo", { gitName: "Fallback User 2", gitEmail: "99+hubot@users.noreply.github.com" });
  const applied = await identity.applyLocalGitIdentity("octo-repo");
  assert.equal(applied.accountLogin, "hubot");
  assert.equal(applied.currentGitName, "Fallback User 2");
  assert.equal(applied.currentGitEmail, "99+hubot@users.noreply.github.com");
  assert.equal(applied.verifiedEmailStatus, "ok");

  await identity.update("octo-repo", { signingMode: "ssh", signingKeyHint: "~/.ssh/id_ed25519.pub" });
  assert.equal(await gitOutput(repoPath, ["config", "--get", "commit.gpgsign"]), "true");
  assert.equal(await gitOutput(repoPath, ["config", "--get", "gpg.format"]), "ssh");
  assert.equal(await gitOutput(repoPath, ["config", "--get", "user.signingkey"]), "~/.ssh/id_ed25519.pub");

  await identity.update("octo-repo", { signingMode: "unsigned", signingKeyHint: null });
  assert.equal(await gitOutput(repoPath, ["config", "--get", "commit.gpgsign"]), "false");
  await assert.rejects(gitOutput(repoPath, ["config", "--get", "gpg.format"]));
  await assert.rejects(gitOutput(repoPath, ["config", "--get", "user.signingkey"]));

  const pixelDigest = "a".repeat(64);
  const pixelIdentity = await identity.update("octo-repo", { signingMode: "pixel", signingKeyHint: pixelDigest });
  assert.equal(pixelIdentity.signingMode, "pixel");
  assert.equal(pixelIdentity.signingKeyHint, pixelDigest);
  assert.equal(await gitOutput(repoPath, ["config", "--get", "commit.gpgsign"]), "false");
  await assert.rejects(gitOutput(repoPath, ["config", "--get", "gpg.format"]));
  await assert.rejects(gitOutput(repoPath, ["config", "--get", "user.signingkey"]));

  const localGit = new LocalGitService(database);
  const operations = createOperationServiceFixture(database);
  await operations.run({
    repoId: "octo-repo",
    kind: "stage_file",
    riskLevel: "low",
    commandSummary: "Stage README.md",
    redactedCommand: "git add -- README.md",
    preflight: () => localGit.recoverySnapshot("octo-repo"),
    execute: () => localGit.stageFile("octo-repo", "README.md")
  });
  const [operation] = database.localCache.operationRecords.listRecent("octo-repo");
  assert.equal(operation.status, "succeeded");
  assert.equal(operation.recoveryBranch, "main");
  assert.ok(operation.recoveryHeadSha);

  await localGit.commit("octo-repo", { summary: "pixel signed commit", description: "body" });
  const commitMessage = await gitOutput(repoPath, ["log", "-1", "--format=%B"]);
  assert.match(commitMessage, /body/);
  assert.match(commitMessage, new RegExp(`Pixel-Signature-SHA256: ${pixelDigest}`));
} finally {
  database.close();
  await rm(tempDir, { force: true, recursive: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return String(stdout).trim();
}

console.log("P0 trust foundation tests ok");
