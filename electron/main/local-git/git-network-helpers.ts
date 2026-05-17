import type { WatchedRepo } from "../../../src/shared/domain/watched-repo.js";
import type { CredentialDiagnosticStatus, RepoRemoteProtocol } from "../../../src/shared/domain/repo-identity.js";
import type { LocalGitNetworkStatus, LocalGitPullStrategy } from "../../../src/shared/domain/local-git.js";
import { gitRaw, gitText } from "../git-command.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LocalGitNetworkError extends Error {
  readonly fallbackCode: string;

  constructor(
    readonly status: LocalGitNetworkStatus,
    message: string,
    readonly diagnosticsRecommended = networkStatusNeedsDiagnostics(status)
  ) {
    super(message);
    this.name = "LocalGitNetworkError";
    this.fallbackCode = `git_network_${status}`;
  }
}

export function classifyGitNetworkError(error: unknown, fallback: LocalGitNetworkStatus): LocalGitNetworkError {
  if (error instanceof LocalGitNetworkError) return error;
  const message = errorMessage(error);
  if (/authentication failed|permission denied|could not read username|repository not found|access denied|publickey/i.test(message)) {
    return new LocalGitNetworkError("auth_failed", message, true);
  }
  if (/protected branch|GH006|GH013|required status|required check|pre-receive hook declined.*protected/i.test(message)) {
    return new LocalGitNetworkError("protected_branch", message, true);
  }
  if (/non-fast-forward|fetch first|failed to push some refs|rejected/i.test(message)) {
    return new LocalGitNetworkError("non_fast_forward", message, false);
  }
  if (/CONFLICT|Automatic merge failed|unmerged files|fix conflicts/i.test(message)) {
    return new LocalGitNetworkError("conflict", message, false);
  }
  if (
    /could not resolve host|network is unreachable|failed to connect|connection refused|connection timed out|couldn't connect|unable to access/i.test(
      message
    )
  ) {
    return new LocalGitNetworkError("remote_unavailable", message, true);
  }
  if (/no upstream|no tracking information/i.test(message)) return new LocalGitNetworkError("no_upstream", message, false);
  if (/hook declined|remote rejected/i.test(message)) return new LocalGitNetworkError("rejected", message, true);
  return new LocalGitNetworkError(fallback, message, networkStatusNeedsDiagnostics(fallback));
}

export function credentialPreflightSummary(
  repo: WatchedRepo,
  accountStatus: string | null,
  identityStatus: string
): { status: CredentialDiagnosticStatus; summary: string | null } {
  if (!accountStatus || accountStatus === "disconnected") return { status: "failed", summary: "No connected GitHub account is active." };
  if (accountStatus !== "connected") return { status: "failed", summary: `GitHub account status is ${accountStatus}.` };
  if (repo.permissions?.pull === false) return { status: "failed", summary: "The active account cannot read this repository." };
  if (repo.permissions?.push === false)
    return { status: "warning", summary: "The active account may not be able to push to this repository." };
  if (identityStatus === "failed") return { status: "failed", summary: "Repo identity or credential diagnostics need attention." };
  if (identityStatus === "warning") return { status: "warning", summary: "Repo identity diagnostics reported warnings." };
  return { status: "ok", summary: "Credentials look ready." };
}

export function gitIdentityLabel(
  identity: { currentGitName?: string | null; currentGitEmail?: string | null; gitName?: string | null; gitEmail?: string | null } | null,
  accountLogin: string | null
): string {
  const name = identity?.currentGitName ?? identity?.gitName ?? null;
  const email = identity?.currentGitEmail ?? identity?.gitEmail ?? null;
  if (name && email) return `${name} <${email}>`;
  if (email) return email;
  if (name) return name;
  if (accountLogin) return `GitHub: ${accountLogin}`;
  return "unknown";
}

export function gitNetworkStatus(input: {
  branch: string | null;
  repoStatus: WatchedRepo["syncStatus"];
  isDirty: boolean;
  hasUpstream: boolean;
  ahead: number | null;
  behind: number | null;
}): LocalGitNetworkStatus {
  if (!input.branch) return "detached";
  if (input.isDirty) return "dirty_worktree";
  if (!input.hasUpstream) return "no_upstream";
  if ((input.ahead ?? 0) > 0 && (input.behind ?? 0) > 0) return "diverged";
  if ((input.behind ?? 0) > 0) return "behind";
  if ((input.ahead ?? 0) > 0) return "ahead";
  if (input.repoStatus === "stale") return "stale";
  if (input.repoStatus === "offline") return "offline";
  if (input.repoStatus === "auth_error") return "auth_failed";
  return "up_to_date";
}

export function gitNetworkStatusMessage(
  status: LocalGitNetworkStatus,
  ahead: number | null,
  behind: number | null,
  pullTarget: string | null
): string {
  switch (status) {
    case "detached":
      return "Detached HEAD. Create or switch to a branch before syncing.";
    case "dirty_worktree":
      return "Local changes present. Commit, stash, or discard them before pulling.";
    case "no_upstream":
      return "No upstream is configured. Publish the branch to create one.";
    case "diverged":
      return `Branch diverged: ${ahead ?? 0} ahead and ${behind ?? 0} behind ${pullTarget ?? "upstream"}.`;
    case "behind":
      return `Branch is ${behind ?? 0} behind ${pullTarget ?? "upstream"}.`;
    case "ahead":
      return `Branch is ${ahead ?? 0} ahead of ${pullTarget ?? "upstream"}.`;
    case "stale":
      return "Repository metadata is stale. Fetch before deciding whether to pull or push.";
    case "offline":
      return "Fallback is offline. Network Git operations may fail.";
    case "auth_failed":
      return "Credentials need attention before network Git operations.";
    case "up_to_date":
      return "Branch is up to date with its upstream.";
    default:
      return "Sync status is available from Git preflight.";
  }
}

export async function firstRemote(cwd: string): Promise<string | null> {
  const remotes = await gitText(cwd, ["remote"]).catch(() => "");
  return (
    remotes
      .split("\n")
      .map((remote) => remote.trim())
      .filter(Boolean)[0] ?? null
  );
}

export async function gitNetworkPreflightFingerprint(cwd: string): Promise<string> {
  const stdout = await gitRaw(cwd, ["status", "--porcelain=v1", "--branch", "--untracked-files=all", "-z"]);
  return `${stdout.length}:${stringHash(stdout)}`;
}

export function stringHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export async function aheadBehind(cwd: string, upstreamRef: string): Promise<{ ahead: number | null; behind: number | null }> {
  const counts = await gitText(cwd, ["rev-list", "--left-right", "--count", `HEAD...${upstreamRef}`]).catch(() => null);
  if (!counts) return { ahead: null, behind: null };
  const [aheadText, behindText] = counts.split(/\s+/);
  const ahead = Number(aheadText);
  const behind = Number(behindText);
  return {
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null
  };
}

export function upstreamRemoteFromRef(upstream: string | null): string | null {
  if (!upstream) return null;
  const index = upstream.indexOf("/");
  return index > 0 ? upstream.slice(0, index) : null;
}

export function upstreamBranchFromRef(upstream: string | null, remote: string | null): string | null {
  if (!upstream || !remote) return null;
  return upstream.startsWith(`${remote}/`) ? upstream.slice(remote.length + 1) : null;
}

export function normalizeBranchMergeRef(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/^refs\/heads\//, "");
}

export function pullStrategyArgs(strategy: LocalGitPullStrategy): string[] {
  if (strategy === "merge") return ["--no-rebase"];
  if (strategy === "rebase") return ["--rebase"];
  return ["--ff-only"];
}

export function remoteProtocol(remoteUrl: string | null): RepoRemoteProtocol {
  if (!remoteUrl) return "unknown";
  if (/^https?:\/\//i.test(remoteUrl)) return "https";
  if (/^(ssh:\/\/|git@)/i.test(remoteUrl)) return "ssh";
  if (/^file:\/\//i.test(remoteUrl) || remoteUrl.startsWith("/") || remoteUrl.startsWith(".")) return "file";
  return "unknown";
}

export function redactRemoteUrl(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  return remoteUrl.replace(/(https?:\/\/)([^/@\s]+)@/i, "$1<redacted>@");
}

export function networkStatusNeedsDiagnostics(status: LocalGitNetworkStatus): boolean {
  return status === "auth_failed" || status === "remote_unavailable" || status === "protected_branch" || status === "rejected";
}
