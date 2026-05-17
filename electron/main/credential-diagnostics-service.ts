import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { WatchedRepo } from "../../src/shared/domain/watched-repo.js";
import type {
  CredentialDiagnosticReport,
  CredentialDiagnosticResult,
  CredentialDiagnosticStatus
} from "../../src/shared/domain/repo-identity.js";
import type { DatabaseService } from "./database-service.js";
import type { GitHubClient } from "./github-client.js";
import { classifyAuthFailure, errorCode, errorMessage, isNetworkError } from "./error-classification.js";
import { gitRaw } from "./git-command.js";
import { IdentityService } from "./identity-service.js";
import { runLinuxDesktopDiagnostics, type LinuxDesktopDiagnosticsOptions } from "./linux-desktop-diagnostics.js";

interface CredentialDiagnosticsOptions {
  gitCommand?: string;
  linuxDiagnostics?: LinuxDesktopDiagnosticsOptions;
}

interface CachedCredentialDiagnostics {
  promise: Promise<CredentialDiagnosticReport>;
}

export class CredentialDiagnosticsService {
  private readonly checkCache = new Map<string, CachedCredentialDiagnostics>();

  constructor(
    private readonly database: DatabaseService,
    private readonly github: GitHubClient,
    private readonly identity: IdentityService,
    private readonly options: CredentialDiagnosticsOptions = {}
  ) {}

  async check(repoId: string): Promise<CredentialDiagnosticReport> {
    const cached = this.checkCache.get(repoId);
    if (cached) return cached.promise;

    const promise = this.runCheck(repoId).finally(() => {
      this.checkCache.delete(repoId);
    });
    this.checkCache.set(repoId, { promise });
    return promise;
  }

  private async runCheck(repoId: string): Promise<CredentialDiagnosticReport> {
    const repo = this.requireRepo(repoId);
    const checkedAt = new Date().toISOString();
    const results: CredentialDiagnosticResult[] = [];
    results.push(await timed("git_binary", () => this.checkGitBinary()));
    results.push(await timed("local_identity", () => this.checkLocalIdentity(repo)));
    const identity = await this.identity.get(repoId);
    results.push(await timed("signing", () => this.checkSigning(identity)));
    results.push(
      ...(await runLinuxDesktopDiagnostics({
        gitCommand: this.options.gitCommand,
        ...this.options.linuxDiagnostics
      }))
    );
    results.push(await timed("api", () => this.checkApi()));
    results.push(await timed("repo_permission", () => this.checkRepoPermission(repo)));
    if (repo.localPath) {
      const remoteParse = remoteUrlCheck(identity.remoteUrl);
      if (remoteParse.status !== "ok") {
        results.push({ surface: "network", durationMs: 0, ...remoteParse });
      } else if (identity.remoteUrl?.startsWith("http")) {
        results.push(await timed("https_remote", () => this.checkRemote(repo.localPath!, repo.fullName)));
      }
      if (identity.remoteUrl?.startsWith("git@") || identity.remoteUrl?.startsWith("ssh://")) {
        results.push(await timed("ssh_remote", () => this.checkRemote(repo.localPath!, repo.fullName)));
      }
    }
    const overallStatus = overall(results);
    this.database.localCache.repoIdentities.upsertRepoIdentity(repoId, {
      lastCheckedAt: checkedAt,
      lastCheckStatus: overallStatus === "ok" ? "ok" : overallStatus === "failed" ? "failed" : "warning"
    });
    this.database.localCache.diagnostics.recordDiagnosticEvent({
      source: "credential_diagnostics",
      level: overallStatus === "failed" ? "error" : overallStatus === "warning" ? "warn" : "info",
      code: `credential_${overallStatus}`,
      message: `${repo.fullName}: ${results.map((result) => `${result.surface}=${result.status}`).join(", ")}`
    });
    this.database.localCache.diagnostics.recordDiagnosticEvent({
      source: "credential_diagnostics",
      level: identity.signingHealth === "missing_key" || identity.signingHealth === "failed" ? "warn" : "info",
      code: "credential_signing_metadata",
      message: `${repo.fullName}: ${signingDiagnosticMessage(identity)}`
    });
    for (const result of results.filter((item) => item.status === "failed")) {
      this.database.localCache.diagnostics.recordDiagnosticEvent({
        source: "credential_diagnostics",
        level: "error",
        code: `credential_${result.surface}_failed`,
        message: `${repo.fullName}: ${result.summary}${result.detail ? ` ${result.detail}` : ""}`
      });
    }
    return { repoId, repoFullName: repo.fullName, checkedAt, overallStatus, results };
  }

  private async checkGitBinary(): Promise<Omit<CredentialDiagnosticResult, "surface" | "durationMs">> {
    await execFilePromise(this.options.gitCommand ?? "git", ["--version"], 10_000);
    return ok("Git is available.", null, null, `${this.options.gitCommand ?? "git"} --version`);
  }

  private async checkLocalIdentity(repo: WatchedRepo): Promise<Omit<CredentialDiagnosticResult, "surface" | "durationMs">> {
    if (!repo.localPath) return warning("Repository is metadata-only.", "Clone the repository to inspect local Git identity.", null, null);
    if (!fs.existsSync(path.join(repo.localPath, ".git"))) {
      return failed("Local path is not a Git repository.", repo.localPath, "Check the watched repo path or re-add the repository.", null);
    }
    const identity = await this.identity.get(repo.id);
    if (identity.mismatchReason)
      return warning("Repo Git identity does not match Fallback identity.", identity.mismatchReason, "Apply repo identity.", null);
    if (!identity.currentGitEmail) return warning("Repo commit email is not configured.", null, "Set repo-local user.email.", null);
    return ok("Repo Git identity is configured.", `${identity.currentGitName ?? "Unknown"} <${identity.currentGitEmail}>`, null, null);
  }

  private async checkSigning(
    identity: Awaited<ReturnType<IdentityService["get"]>>
  ): Promise<Omit<CredentialDiagnosticResult, "surface" | "durationMs">> {
    const mode = identity.currentSigningMode ?? "unknown";
    const health = identity.signingHealth ?? "unknown";
    const detail = signingDiagnosticMessage(identity);
    if (health === "configured") return ok("Commit signing is configured.", detail, null, null);
    if (health === "unsigned") return ok("Commit signing is off.", detail, null, null);
    if (health === "missing_key") {
      return warning(
        mode === "ssh" ? "SSH signing key not configured." : "GPG secret key unavailable.",
        detail,
        mode === "ssh"
          ? "Set user.signingkey to an existing SSH signing key file or public key."
          : "Set user.signingkey or fix GPG signing.",
        null
      );
    }
    if (health === "failed") {
      return warning("Commit signing could not be verified.", detail, "Check Git signing configuration and retry diagnostics.", null);
    }
    return warning("Commit signing state is unknown.", detail, "Clone the repository to inspect local commit signing.", null);
  }

  private async checkApi(): Promise<Omit<CredentialDiagnosticResult, "surface" | "durationMs">> {
    await this.github.get("/user");
    const scopes = githubScopes(this.github) ?? this.database.localCache.accounts.getGitHubAccount()?.tokenScopes ?? [];
    const detail = scopes.length > 0 ? `Token scopes: ${scopes.join(" ")}` : "Token scopes were not reported by GitHub.";
    return ok("GitHub API authentication works.", detail, null, "GET /user");
  }

  private async checkRepoPermission(repo: WatchedRepo): Promise<Omit<CredentialDiagnosticResult, "surface" | "durationMs">> {
    const scopes = githubScopes(this.github) ?? this.database.localCache.accounts.getGitHubAccount()?.tokenScopes ?? [];
    if (repo.isPrivate && scopes.length > 0 && !scopes.includes("repo")) {
      return failed(
        "Token scope is insufficient for private repositories.",
        `Token scopes: ${scopes.join(" ")}`,
        "Reconnect GitHub with repo scope or switch to an account with repository access.",
        `GET /repos/${repo.fullName}`
      );
    }
    const response = await this.github.get<{ permissions?: { pull?: boolean; push?: boolean; admin?: boolean } }>(
      `/repos/${repo.fullName}`
    );
    const permissions = response.permissions;
    if (permissions && !permissions.pull) {
      return failed(
        "Token cannot read this repository.",
        null,
        "Switch account or reconnect with repo access.",
        `GET /repos/${repo.fullName}`
      );
    }
    const detail = permissions
      ? `pull=${Boolean(permissions.pull)}, push=${Boolean(permissions.push)}, admin=${Boolean(permissions.admin)}`
      : "GitHub did not return permission details.";
    return ok("Repository API access works.", detail, null, `GET /repos/${repo.fullName}`);
  }

  private async checkRemote(localPath: string, repoFullName: string): Promise<Omit<CredentialDiagnosticResult, "surface" | "durationMs">> {
    await gitRaw(localPath, ["ls-remote", "--heads", "origin"], 30_000);
    return ok("Git remote authentication works.", null, null, `git -C <repo:${repoFullName}> ls-remote --heads origin`);
  }

  private requireRepo(repoId: string): WatchedRepo {
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo) throw new Error("Repository is not watched.");
    return repo;
  }
}

async function timed(
  surface: CredentialDiagnosticResult["surface"],
  run: () => Promise<Omit<CredentialDiagnosticResult, "surface" | "durationMs">>
): Promise<CredentialDiagnosticResult> {
  const started = Date.now();
  try {
    return { surface, ...(await run()), durationMs: Date.now() - started };
  } catch (error) {
    const diagnostic = diagnosticFailure(surface, error);
    return {
      ...diagnostic,
      durationMs: Date.now() - started
    };
  }
}

function diagnosticFailure(surface: CredentialDiagnosticResult["surface"], error: unknown): Omit<CredentialDiagnosticResult, "durationMs"> {
  if (isNetworkError(error)) {
    return {
      surface: "network",
      status: "failed",
      summary: "Network connectivity failed.",
      detail: errorMessage(error),
      remediation: "Check network connectivity, VPN, proxy, and DNS, then retry diagnostics.",
      redactedCommand: null
    };
  }

  const authFailure = classifyAuthFailure(error);
  if (authFailure?.status === "org_sso_required") {
    return {
      surface: "sso",
      status: "failed",
      summary: "GitHub organization SSO approval is required.",
      detail: authFailure.message,
      remediation: "Open GitHub and authorize this token for the organization, then retry diagnostics.",
      redactedCommand: null
    };
  }
  if (authFailure?.status === "insufficient_scope") {
    return {
      surface: "repo_permission",
      status: "failed",
      summary: "GitHub token is missing required permissions.",
      detail: authFailure.message,
      remediation: "Reconnect GitHub with the required repository scopes.",
      redactedCommand: null
    };
  }
  if (authFailure?.status === "rate_limited") {
    return {
      surface: "api",
      status: "warning",
      summary: "GitHub API rate limit is exhausted.",
      detail: authFailure.message,
      remediation: authFailure.resetAt
        ? `Retry after ${new Date(authFailure.resetAt).toLocaleString()}.`
        : "Wait for the rate limit to reset.",
      redactedCommand: null
    };
  }
  if (authFailure?.status === "revoked" || authFailure?.status === "expired") {
    return {
      surface: "api",
      status: "failed",
      summary: "GitHub token is expired or revoked.",
      detail: authFailure.message,
      remediation: "Reconnect GitHub or switch to a connected account.",
      redactedCommand: null
    };
  }

  return {
    surface,
    status: "failed",
    summary: failureSummary(surface),
    detail: errorMessage(error),
    remediation: remediation(error),
    redactedCommand: null
  };
}

function ok(summary: string, detail: string | null, remediation: string | null, redactedCommand: string | null) {
  return { status: "ok" as const, summary, detail, remediation, redactedCommand };
}

function warning(summary: string, detail: string | null, remediation: string | null, redactedCommand: string | null) {
  return { status: "warning" as const, summary, detail, remediation, redactedCommand };
}

function failed(summary: string, detail: string | null, remediation: string | null, redactedCommand: string | null) {
  return { status: "failed" as const, summary, detail, remediation, redactedCommand };
}

function overall(results: CredentialDiagnosticResult[]): CredentialDiagnosticStatus {
  if (results.some((result) => result.status === "failed")) return "failed";
  if (results.some((result) => result.status === "warning")) return "warning";
  return results.length > 0 ? "ok" : "unknown";
}

function failureSummary(surface: CredentialDiagnosticResult["surface"]): string {
  if (surface === "api") return "GitHub API authentication failed.";
  if (surface === "repo_permission") return "Repository API permission check failed.";
  if (surface === "git_binary") return "Git is unavailable.";
  if (surface === "local_identity") return "Local identity check failed.";
  if (surface === "signing") return "Commit signing check failed.";
  if (surface === "sso") return "GitHub SSO check failed.";
  if (surface === "network") return "Network check failed.";
  return "Git remote authentication failed.";
}

function signingDiagnosticMessage(identity: Awaited<ReturnType<IdentityService["get"]>>): string {
  const parts = [
    `mode=${identity.currentSigningMode ?? "unknown"}`,
    `health=${identity.signingHealth ?? "unknown"}`,
    identity.currentSigningKeyHint ? `key=${identity.currentSigningKeyHint}` : "key=not configured",
    identity.currentGpgProgram ? `gpg.program=${identity.currentGpgProgram}` : null,
    identity.currentAllowedSignersFile ? `gpg.ssh.allowedSignersFile=${identity.currentAllowedSignersFile}` : null,
    identity.signingHealthMessage ?? null
  ];
  return parts.filter(Boolean).join(", ");
}

function remediation(error: unknown): string {
  const code = errorCode(error, "credential_check_failed");
  if (code.startsWith("github_auth")) return "Reconnect GitHub or switch to the correct account.";
  if (code === "network_offline") return "Check network connectivity and retry.";
  return "Run diagnostics again after fixing the reported issue.";
}

function remoteUrlCheck(remoteUrl: string | null): Omit<CredentialDiagnosticResult, "surface" | "durationMs"> {
  if (!remoteUrl) return warning("No Git remote is configured.", null, "Add an origin remote to enable remote credential checks.", null);
  if (remoteUrl.startsWith("https://") || remoteUrl.startsWith("http://")) {
    try {
      new URL(remoteUrl);
      return ok("Remote URL is parseable.", remoteUrlForDisplay(remoteUrl), null, null);
    } catch {
      return failed(
        "Remote URL is not parseable.",
        remoteUrlForDisplay(remoteUrl),
        "Fix the origin remote URL.",
        "git remote set-url origin <url>"
      );
    }
  }
  if (remoteUrl.startsWith("git@") || remoteUrl.startsWith("ssh://") || remoteUrl.startsWith("/") || remoteUrl.startsWith("file://")) {
    return ok("Remote URL is parseable.", remoteUrlForDisplay(remoteUrl), null, null);
  }
  return warning(
    "Remote URL protocol is unknown.",
    remoteUrlForDisplay(remoteUrl),
    "Use HTTPS or SSH remotes for credential checks.",
    null
  );
}

function remoteUrlForDisplay(remoteUrl: string): string {
  return remoteUrl.replaceAll(/\/\/[^/@\s]+@/g, "//[redacted]@");
}

function githubScopes(github: GitHubClient): string[] | null {
  const getOAuthScopes = (github as { getOAuthScopes?: () => string[] | null }).getOAuthScopes;
  return typeof getOAuthScopes === "function" ? getOAuthScopes.call(github) : null;
}

async function execFilePromise(command: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", timeout }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });
}
