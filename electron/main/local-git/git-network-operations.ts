import type {
  LocalGitNetworkAction,
  LocalGitNetworkPreflight,
  LocalGitNetworkResult,
  LocalGitPublishInput,
  LocalGitPullInput
} from "../../../src/shared/domain/local-git.js";
import { gitRaw } from "../git-command.js";
import { LocalGitWorkflowBase, type LocalGitWorkflowDependencies } from "./workflow-base.js";
import {
  LocalGitNetworkError,
  classifyGitNetworkError,
  cleanBranchName,
  cleanExistingRemote,
  pullStrategyArgs
} from "./git-workflow-helpers.js";
import type { GitCommandOptions } from "./git-workflow-helpers.js";

export class GitNetworkOperations extends LocalGitWorkflowBase {
  constructor(deps: LocalGitWorkflowDependencies) {
    super(deps);
  }

  async fetchWorkspace(repoId: string, options: GitCommandOptions = {}): Promise<LocalGitNetworkResult> {
    const preflight = await this.loadGitNetworkPreflight(repoId);
    const repo = this.requireLocalRepo(repoId);
    const remote = preflight.upstreamRemote ?? "origin";
    const beforeHeadSha = preflight.headSha;
    try {
      await gitRaw(repo.localPath, ["fetch", "--prune", remote], 120_000, [0], options.signal);
    } catch (error) {
      throw classifyGitNetworkError(error, "remote_unavailable");
    }
    return this.gitNetworkResult(repoId, "fetch", preflight, beforeHeadSha, "Fetch completed.");
  }

  async pullWorkspace(repoId: string, input: LocalGitPullInput = {}, options: GitCommandOptions = {}): Promise<LocalGitNetworkResult> {
    const preflight = await this.loadGitNetworkPreflight(repoId);
    const repo = this.requireLocalRepo(repoId);
    const strategy = input.strategy ?? "ff-only";
    if (!preflight.upstreamRemote || !preflight.upstreamBranch)
      throw new LocalGitNetworkError("no_upstream", "Current branch has no upstream.");
    if (preflight.isDirty) throw new LocalGitNetworkError("dirty_worktree", "Commit, stash, or discard local changes before pulling.");
    const beforeHeadSha = preflight.headSha;
    const strategyArgs = pullStrategyArgs(strategy);
    try {
      await gitRaw(
        repo.localPath,
        ["pull", ...strategyArgs, preflight.upstreamRemote, preflight.upstreamBranch],
        120_000,
        [0],
        options.signal
      );
    } catch (error) {
      this.invalidateLocalChangesCache(repoId);
      throw classifyGitNetworkError(error, strategy === "ff-only" ? "non_fast_forward" : "conflict");
    }
    this.invalidateLocalChangesCache(repoId);
    return this.gitNetworkResult(repoId, "pull", preflight, beforeHeadSha, `Pull completed with ${strategy} strategy.`);
  }

  async pushWorkspace(repoId: string, options: GitCommandOptions = {}): Promise<LocalGitNetworkResult> {
    const preflight = await this.loadGitNetworkPreflight(repoId);
    const repo = this.requireLocalRepo(repoId);
    if (!preflight.upstreamRemote || !preflight.upstreamBranch)
      throw new LocalGitNetworkError("no_upstream", "Current branch has no upstream.");
    const beforeHeadSha = preflight.headSha;
    try {
      await gitRaw(repo.localPath, ["push", preflight.upstreamRemote, `HEAD:${preflight.upstreamBranch}`], 120_000, [0], options.signal);
    } catch (error) {
      throw classifyGitNetworkError(error, "rejected");
    }
    return this.gitNetworkResult(repoId, "push", preflight, beforeHeadSha, "Push completed.");
  }

  async publishWorkspace(
    repoId: string,
    input: LocalGitPublishInput = {},
    options: GitCommandOptions = {}
  ): Promise<LocalGitNetworkResult> {
    const preflight = await this.loadGitNetworkPreflight(repoId);
    const repo = this.requireLocalRepo(repoId);
    if (!preflight.branch) throw new LocalGitNetworkError("detached", "Detached HEAD cannot be published as a branch.");
    const remote = await cleanExistingRemote(repo.localPath, input.remote?.trim() || preflight.upstreamRemote || "origin");
    const branchName = await cleanBranchName(repo.localPath, input.branchName?.trim() || preflight.branch);
    const beforeHeadSha = preflight.headSha;
    try {
      await gitRaw(repo.localPath, ["push", "-u", remote, `HEAD:${branchName}`], 120_000, [0], options.signal);
    } catch (error) {
      throw classifyGitNetworkError(error, "rejected");
    }
    return this.gitNetworkResult(repoId, "publish", preflight, beforeHeadSha, `Published ${branchName} to ${remote}.`);
  }

  private async gitNetworkResult(
    repoId: string,
    action: LocalGitNetworkAction,
    preflight: LocalGitNetworkPreflight,
    beforeHeadSha: string | null,
    message: string
  ): Promise<LocalGitNetworkResult> {
    this.invalidatePreflightCache(repoId);
    const postflight = await this.loadGitNetworkPreflight(repoId);
    return {
      repoId,
      action,
      branch: postflight.branch,
      upstream: postflight.upstream,
      beforeHeadSha,
      afterHeadSha: postflight.headSha,
      ahead: postflight.ahead,
      behind: postflight.behind,
      status: postflight.status,
      message,
      diagnosticsRecommended: false,
      preflight
    };
  }
}
