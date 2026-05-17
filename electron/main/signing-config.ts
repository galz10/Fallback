import { execFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  RepoIdentity,
  RepoSigningHealth,
  RepoSigningKeyCandidate,
  RepoSigningMode,
  RepoSigningVerification
} from "../../src/shared/domain/repo-identity.js";
import { errorCode, errorMessage } from "./error-classification.js";
import { gitText } from "./git-command.js";

export interface GitSigningState {
  mode: RepoSigningMode;
  keyHint: string | null;
  gpgProgram: string | null;
  allowedSignersFile: string | null;
  health: RepoSigningHealth;
  healthMessage: string | null;
}

export async function inspectGitSigning(localPath: string): Promise<GitSigningState> {
  const gpgsign = await gitText(localPath, ["config", "--bool", "--get", "commit.gpgsign"]).catch(() => null);
  if (gpgsign !== "true") {
    return {
      mode: "unsigned",
      keyHint: null,
      gpgProgram: null,
      allowedSignersFile: null,
      health: "unsigned",
      healthMessage: "Commit signing is off for this repository."
    };
  }

  const [format, signingKey, gpgProgram, allowedSignersFile] = await Promise.all([
    gitText(localPath, ["config", "--get", "gpg.format"]).catch(() => null),
    gitText(localPath, ["config", "--get", "user.signingkey"]).catch(() => null),
    gitText(localPath, ["config", "--get", "gpg.program"]).catch(() => null),
    gitText(localPath, ["config", "--get", "gpg.ssh.allowedSignersFile"]).catch(() => null)
  ]);
  const mode: RepoSigningMode = format === "ssh" ? "ssh" : "gpg";
  const keyHint = signingKeyHint(signingKey, mode);
  const programHint = gpgProgramHint(gpgProgram);
  const allowedSignersHint = allowedSignersFile ? signingPathHint(allowedSignersFile, localPath) : null;

  if (mode === "ssh") {
    if (!signingKey) {
      return {
        mode,
        keyHint: null,
        gpgProgram: programHint,
        allowedSignersFile: allowedSignersHint,
        health: "missing_key",
        healthMessage: "SSH signing key not configured. Set user.signingkey to an existing public key path or SSH signing key."
      };
    }
    if (looksLikePath(signingKey)) {
      const resolved = expandSigningPath(signingKey, localPath);
      try {
        await access(resolved);
      } catch {
        return {
          mode,
          keyHint,
          gpgProgram: programHint,
          allowedSignersFile: allowedSignersHint,
          health: "missing_key",
          healthMessage: `SSH signing key not configured. The configured key file is missing (${keyHint ?? "configured key"}).`
        };
      }
    }
    return {
      mode,
      keyHint,
      gpgProgram: programHint,
      allowedSignersFile: allowedSignersHint,
      health: "configured",
      healthMessage: "SSH commit signing is configured."
    };
  }

  const gpgReadiness = await inspectGpgReadiness(gpgProgram, signingKey);
  if (gpgReadiness.health !== "configured") {
    return {
      mode,
      keyHint,
      gpgProgram: programHint,
      allowedSignersFile: null,
      health: gpgReadiness.health,
      healthMessage: gpgReadiness.message
    };
  }

  return {
    mode,
    keyHint,
    gpgProgram: programHint,
    allowedSignersFile: null,
    health: "configured",
    healthMessage: signingKey ? "GPG commit signing is configured." : "GPG commit signing is enabled; Git will use its default signing key."
  };
}

export async function listSigningKeyCandidates(localPath: string): Promise<RepoSigningKeyCandidate[]> {
  const [configuredKey, format, sshKeys, gpgKeys] = await Promise.all([
    gitText(localPath, ["config", "--get", "user.signingkey"]).catch(() => null),
    gitText(localPath, ["config", "--get", "gpg.format"]).catch(() => null),
    listSshPublicKeys(),
    listGpgSecretKeys().catch(() => [])
  ]);
  const candidates: RepoSigningKeyCandidate[] = [];
  if (configuredKey) {
    const mode = format === "ssh" ? "ssh" : "gpg";
    candidates.push({
      mode,
      key: configuredKey,
      hint: signingKeyHint(configuredKey, mode) ?? "configured key",
      source: "git_config",
      canApply: true
    });
  }
  for (const key of sshKeys) {
    if (!candidates.some((candidate) => candidate.mode === "ssh" && candidate.key === key.key)) candidates.push(key);
  }
  for (const key of gpgKeys) {
    if (!candidates.some((candidate) => candidate.mode === "gpg" && candidate.key === key.key)) candidates.push(key);
  }
  return candidates;
}

export async function verifyGitSigning(localPath: string): Promise<RepoSigningVerification> {
  const generatedAt = new Date().toISOString();
  try {
    const tree = await gitText(localPath, ["rev-parse", "--verify", "HEAD^{tree}"]);
    const head = await gitText(localPath, ["rev-parse", "--verify", "HEAD"]).catch(() => null);
    const args = ["commit-tree", "-S", tree, "-m", "Fallback signing readiness verification"];
    if (head) args.push("-p", head);
    const commitSha = await gitText(localPath, args, 120_000);
    await gitText(localPath, ["verify-commit", commitSha], 30_000);
    return {
      status: "verified",
      summary: "Signing verification succeeded.",
      detail: "Fallback created and verified a signed commit object without updating any branch or project history.",
      remediation: null,
      redactedCommand: "git commit-tree -S HEAD^{tree} -p HEAD -m <verification>",
      commitSha,
      generatedAt
    };
  } catch (error) {
    return {
      status: "failed",
      summary: signingFailureSummary(error),
      detail: errorMessage(error),
      remediation: signingFailureRemediation(error),
      redactedCommand: "git commit-tree -S HEAD^{tree} -p HEAD -m <verification>",
      commitSha: null,
      generatedAt
    };
  }
}

export function signingKeyHint(value: string | null, mode: RepoSigningMode): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (mode === "ssh") {
    if (trimmed.startsWith("ssh-")) return `${trimmed.split(/\s+/)[0]} key`;
    if (trimmed.startsWith("key::")) return "ssh signing key";
    if (looksLikePath(trimmed)) return path.basename(trimmed);
    return redactIdentifier(trimmed);
  }

  if (/^[0-9a-f]{16,}$/i.test(trimmed)) return `GPG key ...${trimmed.slice(-8)}`;
  if (trimmed.includes("@")) return trimmed.replace(/^(.).+(@.+)$/, "$1...$2");
  return redactIdentifier(trimmed);
}

export function signingHealthLabel(identity: Pick<RepoIdentity, "currentSigningMode" | "signingHealth"> | null | undefined): string {
  if (!identity) return "unknown";
  const mode = identity.currentSigningMode ?? "unknown";
  const health = identity.signingHealth ?? "unknown";
  if (health === "configured") return `${mode} / signed`;
  if (health === "unsigned") return "unsigned";
  if (health === "missing_key") return `${mode} / failed`;
  if (health === "failed") return `${mode} / failed`;
  return `${mode} / unknown`;
}

function gpgProgramHint(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return path.basename(trimmed);
}

function signingPathHint(value: string, localPath: string): string {
  return path.basename(expandSigningPath(value, localPath));
}

function redactIdentifier(value: string): string {
  if (value.length <= 8) return "[configured]";
  return `...${value.slice(-6)}`;
}

function looksLikePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("~/") || value.startsWith("./") || value.startsWith("../") || value.includes(path.sep);
}

function expandSigningPath(value: string, localPath: string): string {
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  if (path.isAbsolute(value)) return value;
  return path.resolve(localPath, value);
}

async function inspectGpgReadiness(
  gpgProgram: string | null,
  signingKey: string | null
): Promise<{ health: RepoSigningHealth; message: string }> {
  const command = gpgProgram?.trim() || "gpg";
  const keys = await listGpgSecretKeys(command).catch((error) => {
    const message = errorMessage(error);
    return [{ error: message }];
  });
  if (keys.length === 1 && "error" in keys[0]!) {
    return { health: "failed", message: `GPG secret key unavailable. ${keys[0]!.error}` };
  }
  const candidates = keys.filter((key): key is RepoSigningKeyCandidate => !("error" in key));
  if (candidates.length === 0) {
    return { health: "missing_key", message: "GPG secret key unavailable. No secret keys were reported by gpg." };
  }
  if (!signingKey) return { health: "configured", message: "GPG commit signing is configured with the default secret key." };
  const normalized = signingKey.replace(/^0x/i, "").toLowerCase();
  const found = candidates.some(
    (key) => key.key.toLowerCase().endsWith(normalized) || key.hint.toLowerCase().includes(normalized.slice(-8))
  );
  if (!found) {
    return { health: "missing_key", message: "GPG secret key unavailable. user.signingkey does not match a local secret key." };
  }
  return { health: "configured", message: "GPG commit signing is configured." };
}

async function listSshPublicKeys(): Promise<RepoSigningKeyCandidate[]> {
  const sshDir = path.join(homedir(), ".ssh");
  let names: string[];
  try {
    names = await readdir(sshDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".pub"))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 12)
    .map((name) => ({
      mode: "ssh" as const,
      key: path.join(sshDir, name),
      hint: name,
      source: "ssh_public_key" as const,
      canApply: true
    }));
}

async function listGpgSecretKeys(command = "gpg"): Promise<RepoSigningKeyCandidate[]> {
  const output = await execFileText(command, ["--list-secret-keys", "--with-colons"], 15_000);
  const candidates: RepoSigningKeyCandidate[] = [];
  let pending = false;
  for (const line of output.split(/\r?\n/)) {
    const fields = line.split(":");
    if (fields[0] === "sec") {
      pending = true;
      continue;
    }
    if (pending && fields[0] === "fpr" && fields[9]) {
      const fingerprint = fields[9];
      candidates.push({
        mode: "gpg",
        key: fingerprint,
        hint: signingKeyHint(fingerprint, "gpg") ?? "GPG secret key",
        source: "gpg_secret_key",
        canApply: true
      });
      pending = false;
    }
  }
  return candidates;
}

function execFileText(command: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", timeout }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });
}

function signingFailureSummary(error: unknown): string {
  const message = errorMessage(error);
  if (/pinentry|inappropriate ioctl|agent refused/i.test(message)) return "pinentry unavailable.";
  if (/no secret key|secret key/i.test(message)) return "GPG secret key unavailable.";
  if (/couldn'?t load public key|ssh signing key|user\.signingkey/i.test(message)) return "SSH signing key not configured.";
  if (/gpg failed to sign|failed to sign/i.test(message)) return "Commit signing verification failed.";
  return "Signing verification failed.";
}

function signingFailureRemediation(error: unknown): string {
  const code = errorCode(error, "git_signing_failed");
  const message = errorMessage(error);
  if (/pinentry|inappropriate ioctl|agent refused/i.test(message))
    return "Start or repair the GPG agent and pinentry, then verify signing again.";
  if (/no secret key|secret key/i.test(message))
    return "Choose an existing GPG secret key or import the matching secret key before committing.";
  if (/couldn'?t load public key|ssh signing key|user\.signingkey/i.test(message)) {
    return "Choose an existing SSH public key path or fix user.signingkey before committing.";
  }
  if (code === "git_signing_failed") return "Check user.signingkey, gpg.format, gpg.program, and signing agent access.";
  return "Run signing diagnostics after fixing the reported Git signing error.";
}
