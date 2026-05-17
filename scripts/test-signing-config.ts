import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { inspectGitSigning, listSigningKeyCandidates, signingKeyHint, verifyGitSigning } from "../electron/main/signing-config.js";

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "fallback-signing-config-test-"));
const repoPath = path.join(tempDir, "repo");

try {
  await git(tempDir, ["init", "-b", "main", "repo"]);
  await git(repoPath, ["config", "user.name", "Fallback Test"]);
  await git(repoPath, ["config", "user.email", "fallback@example.com"]);
  await git(repoPath, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(repoPath, "README.md"), "hello\n");
  await git(repoPath, ["add", "README.md"]);
  await git(repoPath, ["commit", "-m", "Initial"]);

  let signing = await inspectGitSigning(repoPath);
  assert.equal(signing.mode, "unsigned");
  assert.equal(signing.health, "unsigned");

  const sshKeyPath = path.join(tempDir, "id_ed25519.pub");
  await writeFile(sshKeyPath, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMaterialThatMustNotLeak test@example.com\n");
  await git(repoPath, ["config", "commit.gpgsign", "true"]);
  await git(repoPath, ["config", "gpg.format", "ssh"]);
  await git(repoPath, ["config", "user.signingkey", sshKeyPath]);
  await git(repoPath, ["config", "gpg.program", "/usr/bin/ssh-keygen"]);
  await git(repoPath, ["config", "gpg.ssh.allowedSignersFile", path.join(tempDir, "allowed_signers")]);

  signing = await inspectGitSigning(repoPath);
  assert.equal(signing.mode, "ssh");
  assert.equal(signing.health, "configured");
  assert.equal(signing.keyHint, "id_ed25519.pub");
  assert.equal(signing.gpgProgram, "ssh-keygen");
  assert.equal(signing.allowedSignersFile, "allowed_signers");
  assert.equal(JSON.stringify(signing).includes("MaterialThatMustNotLeak"), false);

  await git(repoPath, ["config", "user.signingkey", path.join(tempDir, "missing.pub")]);
  signing = await inspectGitSigning(repoPath);
  assert.equal(signing.mode, "ssh");
  assert.equal(signing.health, "missing_key");
  assert.match(signing.healthMessage ?? "", /missing/i);

  await git(repoPath, ["config", "--unset", "gpg.format"]);
  await git(repoPath, ["config", "user.signingkey", "A1234567890ABCDEF"]);
  signing = await inspectGitSigning(repoPath);
  assert.equal(signing.mode, "gpg");
  assert.ok(["configured", "missing_key", "failed"].includes(signing.health));
  assert.equal(signing.keyHint, "GPG key ...90ABCDEF");
  assert.equal(JSON.stringify(signing).includes("A1234567890ABCDEF"), false);

  const candidates = await listSigningKeyCandidates(repoPath);
  assert.ok(candidates.some((candidate) => candidate.source === "git_config" && candidate.hint === "GPG key ...90ABCDEF"));

  await git(repoPath, ["config", "gpg.format", "ssh"]);
  await git(repoPath, ["config", "user.signingkey", path.join(tempDir, "missing.pub")]);
  const verification = await verifyGitSigning(repoPath);
  assert.equal(verification.status, "failed");
  assert.match(verification.summary, /SSH signing key not configured|Signing verification failed|Commit signing verification failed/);
  assert.match(verification.redactedCommand ?? "", /commit-tree -S/);

  assert.equal(signingKeyHint("ssh-ed25519 AAAAsecret", "ssh"), "ssh-ed25519 key");
} finally {
  await rm(tempDir, { force: true, recursive: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

console.log("Signing config tests ok");
