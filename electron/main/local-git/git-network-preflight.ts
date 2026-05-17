import type { LocalGitNetworkPreflight } from "../../../src/shared/domain/local-git.js";
import { gitText } from "../git-command.js";
import { gitNetworkPreflightCacheMs } from "./git-command-cache.js";
import type { TimedPromiseCacheEntry } from "./git-command-cache.js";
import { LocalGitWorkflowBase, type LocalGitWorkflowDependencies } from "./workflow-base.js";
import {
  aheadBehind,
  credentialPreflightSummary,
  firstRemote,
  gitIdentityLabel,
  gitNetworkPreflightFingerprint,
  gitNetworkStatus,
  gitNetworkStatusMessage,
  gitStatus,
  normalizeBranchMergeRef,
  redactRemoteUrl,
  remoteProtocol,
  upstreamBranchFromRef,
  upstreamRemoteFromRef
} from "./git-workflow-helpers.js";

export class GitNetworkPreflightReader extends LocalGitWorkflowBase {
  private readonly gitNetworkPreflightCache = new Map<string, TimedPromiseCacheEntry<LocalGitNetworkPreflight>>();

  constructor(deps: LocalGitWorkflowDependencies) {
    super(deps);
  }

  invalidate(repoId: string): void {
    for (const key of this.gitNetworkPreflightCache.keys()) {
      if (key === repoId || key.startsWith(`${repoId}:`)) this.gitNetworkPreflightCache.delete(key);
    }
  }

  async gitNetworkPreflight(repoId: string): Promise<LocalGitNetworkPreflight> {
    const repo = this.requireLocalRepo(repoId);
    const fingerprint = await gitNetworkPreflightFingerprint(repo.localPath).catch(() => `uncached:${Date.now()}`);
    const cacheKey = `${repoId}:${fingerprint}`;
    for (const key of this.gitNetworkPreflightCache.keys()) {
      if (key !== cacheKey && key.startsWith(`${repoId}:`)) this.gitNetworkPreflightCache.delete(key);
    }
    return this.cachedLocalGitRead(this.gitNetworkPreflightCache, cacheKey, gitNetworkPreflightCacheMs, () =>
      this.loadGitNetworkPreflight(repoId)
    );
  }

  async loadGitNetworkPreflight(repoId: string): Promise<LocalGitNetworkPreflight> {
    const repo = this.requireLocalRepo(repoId);
    const [rawBranch, headSha, statusEntries, firstRemoteName] = await Promise.all([
      gitText(repo.localPath, ["branch", "--show-current"]).catch(() => ""),
      gitText(repo.localPath, ["rev-parse", "HEAD"]).catch(() => null),
      gitStatus(repo.localPath).catch(() => []),
      firstRemote(repo.localPath)
    ]);
    const branch = rawBranch || null;
    const [upstream, configuredRemote, configuredMerge] = branch
      ? await Promise.all([
          gitText(repo.localPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).catch(() => null),
          gitText(repo.localPath, ["config", "--get", `branch.${branch}.remote`]).catch(() => null),
          gitText(repo.localPath, ["config", "--get", `branch.${branch}.merge`]).catch(() => null)
        ])
      : [null, null, null];
    const upstreamRemote = configuredRemote ?? upstreamRemoteFromRef(upstream);
    const upstreamBranch = normalizeBranchMergeRef(configuredMerge) ?? upstreamBranchFromRef(upstream, upstreamRemote);
    const fallbackRemote = upstreamRemote ?? firstRemoteName;
    const [remoteUrl, divergence] = await Promise.all([
      fallbackRemote ? gitText(repo.localPath, ["remote", "get-url", fallbackRemote]).catch(() => null) : Promise.resolve(null),
      upstream ? aheadBehind(repo.localPath, "@{u}") : Promise.resolve({ ahead: null, behind: null })
    ]);
    const identity = this.database.localCache.repoIdentities.getRepoIdentity(repoId);
    const account = this.database.localCache.accounts.getGitHubAccount();
    const credential = credentialPreflightSummary(repo, account?.authStatus ?? null, identity?.lastCheckStatus ?? "unknown");
    const status = gitNetworkStatus({
      branch,
      repoStatus: repo.syncStatus,
      isDirty: statusEntries.length > 0,
      hasUpstream: Boolean(upstream),
      ahead: divergence.ahead,
      behind: divergence.behind
    });
    const pullTarget = upstream ?? (fallbackRemote && upstreamBranch ? `${fallbackRemote}/${upstreamBranch}` : null);

    return {
      repoId,
      repoFullName: repo.fullName,
      workspacePath: repo.localPath,
      identityLabel: gitIdentityLabel(identity, account?.login ?? null),
      branch,
      headSha,
      upstream,
      upstreamRemote: fallbackRemote,
      upstreamBranch,
      remoteUrl: redactRemoteUrl(remoteUrl),
      remoteProtocol: remoteProtocol(remoteUrl ?? identity?.remoteUrl ?? null),
      ahead: divergence.ahead,
      behind: divergence.behind,
      isDirty: statusEntries.length > 0,
      hasUpstream: Boolean(upstream),
      pullStrategy: "ff-only",
      credentialStatus: credential.status,
      credentialSummary: credential.summary,
      branchProtectionHint:
        branch && branch === repo.defaultBranch ? "This is the default branch. Remote branch protection may reject direct pushes." : null,
      signingPolicyHint: identity?.signingMode && identity.signingMode !== "unknown" ? `Signing mode: ${identity.signingMode}` : null,
      status,
      statusMessage: gitNetworkStatusMessage(status, divergence.ahead, divergence.behind, pullTarget),
      actionLabels: {
        fetch: "Fetch",
        pull: pullTarget ? `Pull from ${pullTarget}` : "Pull",
        push:
          divergence.ahead && divergence.ahead > 0 ? `Push ${divergence.ahead} ${divergence.ahead === 1 ? "commit" : "commits"}` : "Push",
        publish: "Publish branch"
      },
      generatedAt: new Date().toISOString()
    };
  }
}
