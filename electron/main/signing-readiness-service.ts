import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { WatchedRepo } from "../../src/shared/domain/watched-repo.js";
import type {
  RepoSigningGitHubKeyStatus,
  RepoSigningMode,
  RepoSigningReadiness,
  RepoSigningRequirement,
  RepoSigningVerification
} from "../../src/shared/domain/repo-identity.js";
import type { DatabaseService } from "./database-service.js";
import { GitHubApiError, type GitHubClient } from "./github-client.js";
import type { IdentityService } from "./identity-service.js";
import { gitText } from "./git-command.js";
import { listSigningKeyCandidates, signingKeyHint, verifyGitSigning } from "./signing-config.js";

export class SigningReadinessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly github: GitHubClient,
    private readonly identity: IdentityService
  ) {}

  async readiness(repoId: string): Promise<RepoSigningReadiness> {
    const repo = this.requireRepo(repoId);
    const identity = await this.identity.get(repoId);
    const requirement = await this.signingRequirement(repo, identity.branch);
    const expectedMode =
      identity.signingMode === "gpg" || identity.signingMode === "ssh"
        ? identity.signingMode
        : requirement.required && (identity.currentSigningMode === "gpg" || identity.currentSigningMode === "ssh")
          ? identity.currentSigningMode
          : identity.signingMode;
    const signingHealth = identity.signingHealth ?? "unknown";
    const configuredLocalSigningKey = repo.localPath ? await readLocalSigningKey(repo.localPath).catch(() => null) : null;
    const githubKeyStatus = await this.githubSigningKeyStatus(expectedMode, configuredLocalSigningKey);
    const satisfiesPolicy =
      !requirement.required && identity.signingMode !== "gpg" && identity.signingMode !== "ssh"
        ? true
        : expectedMode !== "gpg" && expectedMode !== "ssh"
          ? signingHealth === "configured"
          : identity.currentSigningMode === expectedMode && signingHealth === "configured";
    const candidates = repo.localPath ? await listSigningKeyCandidates(repo.localPath) : [];
    return {
      repoId,
      repoFullName: repo.fullName,
      workspacePath: repo.localPath,
      branch: identity.branch,
      identityLabel: `${identity.gitName ?? identity.currentGitName ?? "Unknown"} <${identity.gitEmail ?? identity.currentGitEmail ?? "no email"}>`,
      expectedMode,
      enforcement: requirement.enforcement,
      requirement,
      currentMode: identity.currentSigningMode ?? "unknown",
      currentKeyHint: identity.currentSigningKeyHint ?? null,
      configuredKeyHint: signingKeyHint(identity.signingKeyHint, expectedMode) ?? null,
      gpgProgram: identity.currentGpgProgram ?? null,
      allowedSignersFile: identity.currentAllowedSignersFile ?? null,
      githubKeyStatus,
      signingHealth,
      signingHealthMessage: identity.signingHealthMessage ?? null,
      satisfiesPolicy,
      candidates,
      checks: signingChecks(requirement, identity, satisfiesPolicy, githubKeyStatus),
      generatedAt: new Date().toISOString()
    };
  }

  async verify(repoId: string): Promise<RepoSigningVerification> {
    const repo = this.requireRepo(repoId);
    if (!repo.localPath) {
      return {
        status: "skipped",
        summary: "Signing verification skipped.",
        detail: "Clone the repository to verify signing without updating project history.",
        remediation: "Open a local workspace for this repository, then run signing verification again.",
        redactedCommand: null,
        commitSha: null,
        generatedAt: new Date().toISOString()
      };
    }
    return verifyGitSigning(repo.localPath);
  }

  private async signingRequirement(repo: WatchedRepo, branch: string | null): Promise<RepoSigningRequirement> {
    const checkedAt = new Date().toISOString();
    const identity = this.database.localCache.repoIdentities.getRepoIdentity(repo.id);
    if (identity?.signingMode === "gpg" || identity?.signingMode === "ssh") {
      return {
        required: true,
        enforcement: "repo_policy",
        source: "Fallback repo identity",
        detail: `Fallback repo identity requires ${identity.signingMode.toUpperCase()} signed commits.`,
        checkedAt
      };
    }
    if (!branch) {
      return {
        required: false,
        enforcement: "unknown",
        source: "GitHub branch protection",
        detail: "Branch protection signing requirement could not be checked because the current branch is unknown.",
        checkedAt
      };
    }
    try {
      await this.github.get(`/repos/${repo.fullName}/branches/${encodeURIComponent(branch)}/protection/required_signatures`);
      return {
        required: true,
        enforcement: "branch_protection",
        source: "GitHub branch protection",
        detail: `GitHub branch protection requires signed commits on ${branch}.`,
        checkedAt
      };
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) {
        return {
          required: false,
          enforcement: "none",
          source: "GitHub branch protection",
          detail: `GitHub branch protection did not report signed commits required on ${branch}.`,
          checkedAt
        };
      }
      return {
        required: false,
        enforcement: "unknown",
        source: "GitHub branch protection",
        detail: `GitHub signing requirement could not be checked: ${error instanceof Error ? error.message : String(error)}`,
        checkedAt
      };
    }
  }

  private async githubSigningKeyStatus(mode: RepoSigningMode, localKey: string | null): Promise<RepoSigningGitHubKeyStatus> {
    if (mode !== "ssh" && mode !== "gpg") return "not_applicable";
    if (!localKey) return "unknown";
    try {
      if (mode === "ssh") {
        const uploadedKeys = await this.github.get<Array<{ key?: string | null }>>("/user/ssh_signing_keys");
        const normalizedLocal = normalizeSshPublicKey(localKey);
        if (!normalizedLocal) return "unknown";
        return uploadedKeys.some((key) => normalizeSshPublicKey(key.key ?? null) === normalizedLocal) ? "uploaded" : "not_uploaded";
      }
      const uploadedKeys =
        await this.github.get<Array<{ key_id?: string | null; raw_key?: string | null; subkeys?: Array<{ key_id?: string | null }> }>>(
          "/user/gpg_keys"
        );
      const normalizedLocal = normalizeGpgKeyId(localKey);
      if (!normalizedLocal) return "unknown";
      return uploadedKeys.some((key) => gpgKeyIds(key).some((id) => id.endsWith(normalizedLocal) || normalizedLocal.endsWith(id)))
        ? "uploaded"
        : "not_uploaded";
    } catch {
      return "unknown";
    }
  }

  private requireRepo(repoId: string): WatchedRepo {
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo) throw new Error("Repository is not watched.");
    return repo;
  }
}

function signingChecks(
  requirement: RepoSigningRequirement,
  identity: Awaited<ReturnType<IdentityService["get"]>>,
  satisfiesPolicy: boolean,
  githubKeyStatus: RepoSigningGitHubKeyStatus
): RepoSigningReadiness["checks"] {
  const checks: RepoSigningReadiness["checks"] = [
    {
      status: requirement.enforcement === "unknown" ? "warning" : "ok",
      summary: requirement.required ? "Signed commits are required." : "Signed commits are optional.",
      detail: requirement.detail,
      remediation: requirement.enforcement === "unknown" ? "Run diagnostics again or check branch protection in GitHub." : null,
      redactedCommand:
        requirement.source === "GitHub branch protection" ? "GET /repos/<repo>/branches/<branch>/protection/required_signatures" : null
    }
  ];
  const signingMode =
    identity.signingMode === "ssh" || identity.signingMode === "gpg" ? identity.signingMode : (identity.currentSigningMode ?? "unknown");
  if (signingMode === "ssh") {
    const hasActiveSshKey = identity.currentSigningMode === "ssh" && Boolean(identity.currentSigningKeyHint);
    const configuredHint = signingKeyHint(identity.signingKeyHint, "ssh");
    checks.push({
      status: hasActiveSshKey ? "ok" : "warning",
      summary: hasActiveSshKey ? "SSH signing key configured." : "SSH signing key not configured.",
      detail: identity.currentSigningKeyHint
        ? `user.signingkey=${identity.currentSigningKeyHint}`
        : configuredHint
          ? `configured key=${configuredHint}`
          : null,
      remediation: identity.currentSigningKeyHint ? null : "Choose an existing SSH public key or set user.signingkey.",
      redactedCommand: "git config --local user.signingkey <ssh-public-key-or-path>"
    });
    checks.push({
      status: identity.currentAllowedSignersFile ? "ok" : "warning",
      summary: identity.currentAllowedSignersFile ? "Allowed signers file configured." : "Allowed signers file not configured.",
      detail: identity.currentAllowedSignersFile ? `gpg.ssh.allowedSignersFile=${identity.currentAllowedSignersFile}` : null,
      remediation: identity.currentAllowedSignersFile
        ? null
        : "Configure gpg.ssh.allowedSignersFile if your verification flow requires local SSH signature verification.",
      redactedCommand: "git config --local gpg.ssh.allowedSignersFile <path>"
    });
  }
  if (signingMode === "gpg") {
    checks.push({
      status: identity.signingHealth === "configured" ? "ok" : identity.signingHealth === "missing_key" ? "failed" : "warning",
      summary:
        identity.signingHealth === "configured"
          ? "GPG secret key available."
          : identity.signingHealth === "missing_key"
            ? "GPG secret key unavailable."
            : "GPG signing needs attention.",
      detail: identity.signingHealthMessage ?? null,
      remediation:
        identity.signingHealth === "configured" ? null : "Choose a local GPG secret key, import the secret key, or repair gpg.program.",
      redactedCommand: "gpg --list-secret-keys --with-colons"
    });
  }
  if (signingMode === "ssh" || signingMode === "gpg") {
    checks.push({
      status: githubKeyStatus === "uploaded" ? "ok" : githubKeyStatus === "not_uploaded" ? "warning" : "warning",
      summary:
        githubKeyStatus === "uploaded"
          ? "GitHub signing key uploaded."
          : githubKeyStatus === "not_uploaded"
            ? "GitHub signing key not uploaded."
            : "GitHub signing key upload could not be checked.",
      detail:
        githubKeyStatus === "uploaded"
          ? "The configured signing key appears in the current GitHub account's signing keys."
          : githubKeyStatus === "not_uploaded"
            ? "GitHub may not mark signed commits as verified until the matching signing key is uploaded."
            : "Fallback could not compare the local signing key with GitHub signing keys.",
      remediation:
        githubKeyStatus === "uploaded"
          ? null
          : signingMode === "ssh"
            ? "Upload the matching SSH signing key in GitHub SSH and GPG keys settings."
            : "Upload the matching GPG public key in GitHub SSH and GPG keys settings.",
      redactedCommand: signingMode === "ssh" ? "GET /user/ssh_signing_keys" : "GET /user/gpg_keys"
    });
  }
  checks.push({
    status: satisfiesPolicy ? "ok" : "failed",
    summary: satisfiesPolicy ? "Current workspace satisfies signing policy." : "Current workspace does not satisfy signing policy.",
    detail: identity.signingHealthMessage ?? null,
    remediation: satisfiesPolicy ? null : "Use the signing setup dialog to apply repo-local signing config, then verify signing.",
    redactedCommand: "git commit-tree -S HEAD^{tree} -p HEAD -m <verification>"
  });
  return checks;
}

async function readLocalSigningKey(localPath: string): Promise<string | null> {
  const key = await gitText(localPath, ["config", "--get", "user.signingkey"]).catch(() => null);
  if (!key) return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("ssh-") || trimmed.startsWith("key::")) return trimmed;
  if (looksLikePath(trimmed)) {
    const publicKey = await readFile(resolveSigningPath(trimmed, localPath), "utf8").catch(() => null);
    return publicKey?.trim() ?? trimmed;
  }
  return trimmed;
}

function normalizeSshPublicKey(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^key::/, "");
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2 || !parts[0]?.startsWith("ssh-")) return null;
  return `${parts[0]} ${parts[1]}`;
}

function normalizeGpgKeyId(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/^0x/i, "").replaceAll(/\s+/g, "").toLowerCase();
  return /^[0-9a-f]{8,}$/i.test(normalized) ? normalized : null;
}

function gpgKeyIds(key: { key_id?: string | null; raw_key?: string | null; subkeys?: Array<{ key_id?: string | null }> }): string[] {
  return [key.key_id, ...(key.subkeys ?? []).map((subkey) => subkey.key_id), ...gpgFingerprintsFromRawKey(key.raw_key)]
    .map((value) => normalizeGpgKeyId(value ?? null))
    .filter((value): value is string => Boolean(value));
}

function gpgFingerprintsFromRawKey(rawKey: string | null | undefined): string[] {
  return rawKey?.match(/[0-9a-f]{16,40}/gi) ?? [];
}

function looksLikePath(value: string): boolean {
  return path.isAbsolute(value) || value.startsWith("~/") || value.startsWith("./") || value.startsWith("../");
}

function resolveSigningPath(value: string, localPath: string): string {
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  if (path.isAbsolute(value)) return value;
  return path.resolve(localPath, value);
}
