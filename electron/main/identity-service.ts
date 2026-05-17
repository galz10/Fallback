import type { GitHubAccountSession } from "../../src/shared/domain/auth.js";
import type { WatchedRepo } from "../../src/shared/domain/watched-repo.js";
import type { RepoIdentity, UpdateRepoIdentityInput } from "../../src/shared/domain/repo-identity.js";
import type { DatabaseService } from "./database-service.js";
import { gitRaw, gitText } from "./git-command.js";
import { inspectGitSigning } from "./signing-config.js";

interface GitCommandOptions {
  signal?: AbortSignal;
}

export class IdentityService {
  private readonly cache = new Map<string, { expiresAt: number; value: Promise<RepoIdentity> }>();

  constructor(private readonly database: DatabaseService) {}

  async get(repoId: string): Promise<RepoIdentity> {
    const cached = this.cache.get(repoId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = this.read(repoId);
    this.cache.set(repoId, { expiresAt: Date.now() + 30_000, value });
    try {
      return await value;
    } catch (error) {
      this.cache.delete(repoId);
      throw error;
    }
  }

  private async read(repoId: string): Promise<RepoIdentity> {
    const repo = this.requireRepo(repoId);
    const existing = this.database.localCache.repoIdentities.getRepoIdentity(repoId);
    const account = existing?.accountId
      ? this.database.localCache.accounts.getGitHubAccountById(existing.accountId)
      : (this.database.localCache.accounts.getGitHubAccount() ?? null);
    const local = await this.localIdentity(repo);
    const identity = existing
      ? this.adoptActiveAccountForUnboundIdentity(repoId, existing, local, account)
      : this.database.localCache.repoIdentities.upsertRepoIdentity(repoId, {
          accountId: account?.id ?? null,
          endpoint: account?.endpoint ?? "https://api.github.com",
          gitName: local.currentGitName ?? account?.name ?? account?.login ?? null,
          gitEmail: local.currentGitEmail,
          remoteProtocol: local.remoteProtocol
        });

    return this.mergeRuntime(this.trustAccountNoreplyEmail(repoId, identity, local, account), local);
  }

  private adoptActiveAccountForUnboundIdentity(
    repoId: string,
    identity: RepoIdentity,
    local: RuntimeIdentity,
    account: GitHubAccountSession | null
  ): RepoIdentity {
    if (identity.accountId || !account || !repoIdentityMatchesAccount(identity, local, account)) return identity;
    return this.database.localCache.repoIdentities.upsertRepoIdentity(repoId, {
      accountId: account.id,
      endpoint: account.endpoint,
      gitName: identity.gitName ?? local.currentGitName ?? account.name ?? account.login ?? null,
      gitEmail: identity.gitEmail ?? local.currentGitEmail
    });
  }

  private trustAccountNoreplyEmail(
    repoId: string,
    identity: RepoIdentity,
    local: RuntimeIdentity,
    account: GitHubAccountSession | null
  ): RepoIdentity {
    if (!account || !repoIdentityMatchesAccount(identity, local, account)) return identity;
    if (identity.verifiedEmailStatus !== "unknown" && identity.verifiedEmailStatus !== "warning") return identity;
    return this.database.localCache.repoIdentities.upsertRepoIdentity(repoId, {
      verifiedEmailStatus: "ok"
    });
  }

  async update(repoId: string, input: UpdateRepoIdentityInput, options: GitCommandOptions = {}): Promise<RepoIdentity> {
    this.cache.delete(repoId);
    const repo = this.requireRepo(repoId);
    const account = input.accountId ? this.database.localCache.accounts.getGitHubAccountById(input.accountId) : null;
    if (input.accountId && !account) throw new Error("GitHub account not found.");
    const patch: Parameters<DatabaseService["localCache"]["repoIdentities"]["upsertRepoIdentity"]>[1] = {};
    if (hasOwn(input, "accountId")) patch.accountId = input.accountId;
    if (account) patch.endpoint = account.endpoint;
    if (hasOwn(input, "gitName")) patch.gitName = input.gitName;
    if (hasOwn(input, "gitEmail")) patch.gitEmail = input.gitEmail;
    if (hasOwn(input, "signingMode")) patch.signingMode = input.signingMode;
    if (hasOwn(input, "signingKeyHint")) patch.signingKeyHint = input.signingKeyHint;
    if (hasOwn(input, "remoteProtocol")) patch.remoteProtocol = input.remoteProtocol;
    this.database.localCache.repoIdentities.upsertRepoIdentity(repoId, patch);
    if (repo.localPath) {
      if (hasOwn(input, "gitName") && input.gitName)
        await gitRaw(repo.localPath, ["config", "--local", "user.name", input.gitName], 30_000, [0], options.signal);
      if (hasOwn(input, "gitEmail") && input.gitEmail)
        await gitRaw(repo.localPath, ["config", "--local", "user.email", input.gitEmail], 30_000, [0], options.signal);
      if (hasOwn(input, "signingMode") || hasOwn(input, "signingKeyHint")) {
        const updatedIdentity = this.database.localCache.repoIdentities.getRepoIdentity(repoId);
        await this.applySigningConfig(
          repo.localPath,
          updatedIdentity?.signingMode ?? "unknown",
          updatedIdentity?.signingKeyHint ?? null,
          options
        );
      }
    }
    return this.get(repoId);
  }

  async applyLocalGitIdentity(repoId: string, options: GitCommandOptions = {}): Promise<RepoIdentity> {
    this.cache.delete(repoId);
    const repo = this.requireRepo(repoId);
    const identity = await this.get(repoId);
    if (!repo.localPath) throw new Error("Repo identity can only be applied to cloned repositories.");
    if (identity.gitName) await gitRaw(repo.localPath, ["config", "--local", "user.name", identity.gitName], 30_000, [0], options.signal);
    if (identity.gitEmail)
      await gitRaw(repo.localPath, ["config", "--local", "user.email", identity.gitEmail], 30_000, [0], options.signal);
    await this.applySigningConfig(repo.localPath, identity.signingMode, identity.signingKeyHint, options);
    this.cache.delete(repoId);
    return this.get(repoId);
  }

  private async applySigningConfig(
    localPath: string,
    mode: RepoIdentity["signingMode"],
    signingKey: string | null,
    options: GitCommandOptions = {}
  ): Promise<void> {
    const key = signingKey?.trim() ?? "";
    if (mode === "unsigned" || mode === "pixel") {
      await gitRaw(localPath, ["config", "--local", "commit.gpgsign", "false"], 30_000, [0], options.signal);
      await gitRaw(localPath, ["config", "--local", "--unset", "gpg.format"], 30_000, [0, 5], options.signal);
      await gitRaw(localPath, ["config", "--local", "--unset", "user.signingkey"], 30_000, [0, 5], options.signal);
      return;
    }
    if (mode === "ssh") {
      await gitRaw(localPath, ["config", "--local", "commit.gpgsign", "true"], 30_000, [0], options.signal);
      await gitRaw(localPath, ["config", "--local", "gpg.format", "ssh"], 30_000, [0], options.signal);
      if (key) await gitRaw(localPath, ["config", "--local", "user.signingkey", key], 30_000, [0], options.signal);
      else await gitRaw(localPath, ["config", "--local", "--unset", "user.signingkey"], 30_000, [0, 5], options.signal);
      return;
    }
    if (mode === "gpg") {
      await gitRaw(localPath, ["config", "--local", "commit.gpgsign", "true"], 30_000, [0], options.signal);
      await gitRaw(localPath, ["config", "--local", "--unset", "gpg.format"], 30_000, [0, 5], options.signal);
      if (key) await gitRaw(localPath, ["config", "--local", "user.signingkey", key], 30_000, [0], options.signal);
      else await gitRaw(localPath, ["config", "--local", "--unset", "user.signingkey"], 30_000, [0, 5], options.signal);
    }
  }

  private mergeRuntime(identity: RepoIdentity, local: RuntimeIdentity): RepoIdentity {
    const mismatchReason =
      identity.gitEmail && local.currentGitEmail && identity.gitEmail !== local.currentGitEmail
        ? `Repo config uses ${local.currentGitEmail}; Fallback identity is ${identity.gitEmail}.`
        : identity.gitName && local.currentGitName && identity.gitName !== local.currentGitName
          ? `Repo config uses ${local.currentGitName}; Fallback identity is ${identity.gitName}.`
          : null;
    return {
      ...identity,
      currentGitName: local.currentGitName,
      currentGitEmail: local.currentGitEmail,
      currentSigningMode: local.currentSigningMode,
      currentSigningKeyHint: local.currentSigningKeyHint,
      currentGpgProgram: local.currentGpgProgram,
      currentAllowedSignersFile: local.currentAllowedSignersFile,
      signingHealth: local.signingHealth,
      signingHealthMessage: local.signingHealthMessage,
      branch: local.branch,
      remoteUrl: local.remoteUrl,
      remoteProtocol: identity.remoteProtocol === "unknown" ? local.remoteProtocol : identity.remoteProtocol,
      mismatchReason
    };
  }

  private async localIdentity(repo: WatchedRepo): Promise<RuntimeIdentity> {
    if (!repo.localPath) {
      return {
        currentGitName: null,
        currentGitEmail: null,
        currentSigningMode: "unknown",
        currentSigningKeyHint: null,
        currentGpgProgram: null,
        currentAllowedSignersFile: null,
        signingHealth: "unknown",
        signingHealthMessage: "Clone the repository to inspect commit signing.",
        branch: repo.defaultBranch,
        remoteUrl: repo.htmlUrl,
        remoteProtocol: "unknown"
      };
    }
    const [currentGitName, currentGitEmail, signing, branch, remoteUrl] = await Promise.all([
      gitText(repo.localPath, ["config", "--get", "user.name"]).catch(() => null),
      gitText(repo.localPath, ["config", "--get", "user.email"]).catch(() => null),
      inspectGitSigning(repo.localPath).catch(() => ({
        mode: "unknown" as const,
        keyHint: null,
        gpgProgram: null,
        allowedSignersFile: null,
        health: "failed" as const,
        healthMessage: "Fallback could not inspect commit signing for this repository."
      })),
      gitText(repo.localPath, ["branch", "--show-current"]).catch(() => repo.defaultBranch),
      gitText(repo.localPath, ["remote", "get-url", "origin"]).catch(() => null)
    ]);
    return {
      currentGitName,
      currentGitEmail,
      currentSigningMode: signing.mode,
      currentSigningKeyHint: signing.keyHint,
      currentGpgProgram: signing.gpgProgram,
      currentAllowedSignersFile: signing.allowedSignersFile,
      signingHealth: signing.health,
      signingHealthMessage: signing.healthMessage,
      branch,
      remoteUrl,
      remoteProtocol: remoteProtocol(remoteUrl)
    };
  }

  private requireRepo(repoId: string): WatchedRepo {
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo) throw new Error("Repository is not watched.");
    return repo;
  }
}

function hasOwn<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function repoIdentityMatchesAccount(identity: RepoIdentity, local: RuntimeIdentity, account: GitHubAccountSession): boolean {
  const gitEmail = (identity.gitEmail ?? local.currentGitEmail)?.toLowerCase();
  if (!gitEmail || !account.githubUserId || !account.login) return false;
  if (identity.accountEndpoint !== account.endpoint) return false;
  const login = account.login.toLowerCase();
  const userId = account.githubUserId.toLowerCase();
  return gitEmail === `${userId}+${login}@users.noreply.github.com` || gitEmail === `${login}@users.noreply.github.com`;
}

interface RuntimeIdentity {
  currentGitName: string | null;
  currentGitEmail: string | null;
  currentSigningMode: RepoIdentity["signingMode"];
  currentSigningKeyHint: string | null;
  currentGpgProgram: string | null;
  currentAllowedSignersFile: string | null;
  signingHealth: NonNullable<RepoIdentity["signingHealth"]>;
  signingHealthMessage: string | null;
  branch: string | null;
  remoteUrl: string | null;
  remoteProtocol: RepoIdentity["remoteProtocol"];
}

function remoteProtocol(remoteUrl: string | null): RepoIdentity["remoteProtocol"] {
  if (!remoteUrl) return "unknown";
  if (remoteUrl.startsWith("http://") || remoteUrl.startsWith("https://")) return "https";
  if (remoteUrl.startsWith("git@") || remoteUrl.startsWith("ssh://")) return "ssh";
  if (remoteUrl.startsWith("/") || remoteUrl.startsWith("file://")) return "file";
  return "unknown";
}
