import type { PullRequestDiff } from "../../../src/shared/domain/github-work.js";
import type {
  BranchCommitObservation,
  BranchRecoveryPlan,
  BranchRecoveryResult,
  BranchSnapshot,
  BranchSnapshotInput
} from "../../../src/shared/domain/branch-integrity.js";
import { parsePullRequestNumbersFromCommitMessage } from "../../../src/shared/branch-integrity.js";
import { safeRefComponent } from "../../../src/shared/recovery-record.js";
import { gitRaw, gitText } from "../git-command.js";
import { branchIntegrityRemoteFetchCacheMs, fallbackSafetyRefsFetchCacheMs } from "./git-command-cache.js";
import type { TimedPromiseCacheEntry } from "./git-command-cache.js";
import { LocalGitWorkflowBase, type LocalGitWorkflowDependencies } from "./workflow-base.js";
import {
  cleanCommitSha,
  fallbackSafetyRefsFetchCacheKey,
  gitStatus,
  mergeStats,
  parseNameStatus,
  parseNumstat,
  remotePruneFetchCacheKey
} from "./git-workflow-helpers.js";

export class BranchIntegrityGitReader extends LocalGitWorkflowBase {
  private readonly remotePruneFetchCache = new Map<string, TimedPromiseCacheEntry<boolean>>();
  private readonly fallbackSafetyRefsFetchCache = new Map<string, TimedPromiseCacheEntry<boolean>>();

  constructor(deps: LocalGitWorkflowDependencies) {
    super(deps);
  }

  async branchSnapshot(input: BranchSnapshotInput): Promise<BranchSnapshot> {
    const repo = this.requireLocalRepo(input.repoId);
    const branchName = input.branch ?? repo.defaultBranch ?? "main";
    const remoteName = input.remote ?? "origin";
    const remoteRef = `${remoteName}/${branchName}`;
    await this.fetchRemotePrune(input.repoId, remoteName);
    const [headSha, treeSha, parents, committedAt] = await Promise.all([
      gitText(repo.localPath, ["rev-parse", remoteRef]),
      gitText(repo.localPath, ["rev-parse", `${remoteRef}^{tree}`]),
      gitText(repo.localPath, ["show", "-s", "--format=%P", remoteRef]).catch(() => ""),
      gitText(repo.localPath, ["show", "-s", "--format=%cI", remoteRef]).catch(() => "")
    ]);
    const parentShas = parents.split(/\s+/).filter(Boolean);
    const snapshot: BranchSnapshot = {
      repoId: input.repoId,
      branchName,
      remoteName,
      headSha,
      treeSha,
      parentSha: parentShas[0] ?? null,
      firstParentSha: parentShas[0] ?? null,
      committedAt: committedAt || null,
      observedAt: new Date().toISOString(),
      source: input.source ?? "sync",
      checkpointRef: null,
      notes: null
    };
    return snapshot;
  }

  async firstParentAudit(
    repoId: string,
    options: { branch?: string; remote?: string; since?: string; until?: string; limit?: number } = {}
  ): Promise<BranchCommitObservation[]> {
    const repo = this.requireLocalRepo(repoId);
    const branchName = options.branch ?? repo.defaultBranch ?? "main";
    const remoteName = options.remote ?? "origin";
    const remoteRef = `${remoteName}/${branchName}`;
    await this.fetchRemotePrune(repoId, remoteName);
    const args = ["log", "--first-parent", "--format=%H%x00%P%x00%T%x00%cI%x00%an%x00%ae%x00%s%x00%B%x1e"];
    if (options.since) args.push(`--since=${options.since}`);
    if (options.until) args.push(`--until=${options.until}`);
    args.push(`-${Math.min(Math.max(Math.floor(options.limit ?? 40), 1), 200)}`, remoteRef);
    const stdout = await gitRaw(repo.localPath, args, 60_000);
    const records = stdout
      .split("\x1e")
      .map((record) => record.trim())
      .filter(Boolean);
    const observations: BranchCommitObservation[] = [];
    for (const record of records) {
      const [sha = "", parents = "", treeSha = "", committedAt = "", authorName = "", authorEmail = "", subject = "", body = ""] =
        record.split("\0");
      if (!sha) continue;
      const parentShas = parents.split(/\s+/).filter(Boolean);
      const firstParentSha = parentShas[0] ?? null;
      const rangeArgs = firstParentSha ? [firstParentSha, sha] : [`${sha}^!`];
      const [numstat, nameStatus] = await Promise.all([
        gitRaw(repo.localPath, ["diff", "--numstat", "--find-renames", ...rangeArgs], 60_000).catch(() => ""),
        gitRaw(repo.localPath, ["diff", "--name-status", "--find-renames", ...rangeArgs], 60_000).catch(() => "")
      ]);
      const stats = mergeStats(parseNumstat(numstat));
      const files = parseNameStatus(nameStatus).map((file) => {
        const totals = stats.get(file.path) ?? { additions: 0, deletions: 0 };
        return {
          path: file.path,
          previousPath: file.previousPath,
          status: file.status,
          additions: totals.additions,
          deletions: totals.deletions
        };
      });
      const totals = files.reduce(
        (sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }),
        { additions: 0, deletions: 0 }
      );
      const message = `${subject}\n\n${body}`;
      observations.push({
        sha,
        treeSha,
        parentShas,
        parentSha: firstParentSha,
        firstParentSha,
        subject,
        body,
        authorName: authorName || null,
        authorEmail: authorEmail || null,
        committedAt: committedAt || null,
        additions: totals.additions,
        deletions: totals.deletions,
        changedFiles: files.length,
        files,
        prNumbers: parsePullRequestNumbersFromCommitMessage(message)
      });
    }
    return observations;
  }

  async fetchFallbackSafetyRefs(repoId: string, remote = "origin", options: { force?: boolean } = {}): Promise<boolean> {
    if (options.force) this.fallbackSafetyRefsFetchCache.delete(fallbackSafetyRefsFetchCacheKey(repoId, remote));
    return this.cachedLocalGitRead(
      this.fallbackSafetyRefsFetchCache,
      fallbackSafetyRefsFetchCacheKey(repoId, remote),
      fallbackSafetyRefsFetchCacheMs,
      () => this.loadFallbackSafetyRefs(repoId, remote)
    );
  }

  private async loadFallbackSafetyRefs(repoId: string, remote: string): Promise<boolean> {
    const repo = this.requireLocalRepo(repoId);
    const result = await gitRaw(repo.localPath, ["fetch", remote, "+refs/fallback/*:refs/fallback/*"], 60_000, [0, 1, 128]).catch(() => "");
    return !result.toLowerCase().includes("couldn't find remote ref") && !result.toLowerCase().includes("fatal:");
  }

  async listFallbackSafetyRefs(repoId: string): Promise<Array<{ ref: string; sha: string; treeSha: string | null }>> {
    const repo = this.requireLocalRepo(repoId);
    const stdout = await gitRaw(repo.localPath, ["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/fallback"], 30_000).catch(
      () => ""
    );
    const refs = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [ref, sha] = line.split("\0");
        return { ref, sha };
      })
      .filter((item): item is { ref: string; sha: string } => Boolean(item.ref && item.sha));
    return Promise.all(
      refs.map(async (item) => ({
        ...item,
        treeSha: await gitText(repo.localPath, ["rev-parse", `${item.sha}^{tree}`]).catch(() => null)
      }))
    );
  }

  async branchDiff(repoId: string, baseRef: string, targetRef: string, number = 0): Promise<PullRequestDiff> {
    const repo = this.requireLocalRepo(repoId);
    await gitRaw(repo.localPath, ["cat-file", "-e", `${baseRef}^{tree}`], 30_000);
    await gitRaw(repo.localPath, ["cat-file", "-e", `${targetRef}^{tree}`], 30_000);
    const patch = await gitRaw(repo.localPath, ["diff", "--patch", "--find-renames", baseRef, targetRef], 120_000);
    return {
      repoId,
      number,
      patch,
      source: "local",
      cachedAt: new Date().toISOString(),
      fromCache: false
    };
  }

  async createBranchIntegrityRecovery(repoId: string, plan: BranchRecoveryPlan): Promise<BranchRecoveryResult> {
    const repo = this.requireLocalRepo(repoId);
    const currentStatus = await gitStatus(repo.localPath);
    if (currentStatus.length > 0) throw new Error("Commit, stash, or discard local changes before creating a recovery branch.");
    const baseRef = `${repo.defaultBranch ? "origin/" : ""}${repo.defaultBranch ?? plan.branchName}`;
    await gitRaw(repo.localPath, ["fetch", "origin", "--prune"], 60_000).catch(() => "");
    const baseSha = await gitText(repo.localPath, ["rev-parse", `${baseRef}^{commit}`]).catch(() =>
      gitText(repo.localPath, ["rev-parse", `${plan.baseSha}^{commit}`])
    );
    const safetyRef = `refs/fallback/recovery/${safeRefComponent(plan.recoveryBranchName)}`;
    await gitRaw(repo.localPath, ["update-ref", safetyRef, baseSha], 30_000).catch(() => "");
    await gitRaw(repo.localPath, ["switch", "-C", plan.recoveryBranchName, baseSha], 120_000);

    if (plan.strategy === "revert_bad_commit") {
      const commitSha =
        plan.steps
          .find((step) => step.type === "revert_commit")
          ?.command?.split(" ")
          .at(-1) ?? "";
      await gitRaw(repo.localPath, ["revert", "--no-commit", cleanCommitSha(commitSha)], 120_000);
    } else if (plan.strategy === "restore_tested_tree") {
      const restoreRef = plan.steps.find((step) => step.type === "restore_tree")?.command?.match(/--source\s+(\S+)/)?.[1];
      if (!restoreRef) throw new Error("Recovery plan is missing a tested tree source.");
      await gitRaw(repo.localPath, ["restore", "--source", restoreRef, "--worktree", "--staged", "."], 120_000);
    } else {
      throw new Error("This recovery strategy requires manual reconstruction.");
    }

    const changes = await this.changes(repoId);
    return {
      repoId,
      branchName: plan.branchName,
      recoveryBranchName: plan.recoveryBranchName,
      strategy: plan.strategy,
      safetyRef,
      baseSha,
      stagedFiles: changes.files.filter((file) => file.staged).length,
      additions: changes.additions,
      deletions: changes.deletions,
      message: "Recovery branch prepared with staged changes for review."
    };
  }

  async pushCurrentBranch(repoId: string, branchName: string): Promise<void> {
    const repo = this.requireLocalRepo(repoId);
    await gitRaw(repo.localPath, ["push", "-u", "origin", `HEAD:${branchName}`], 120_000);
  }

  private async fetchRemotePrune(repoId: string, remote: string): Promise<boolean> {
    return this.cachedLocalGitRead(
      this.remotePruneFetchCache,
      remotePruneFetchCacheKey(repoId, remote),
      branchIntegrityRemoteFetchCacheMs,
      () => this.loadRemotePrune(repoId, remote)
    );
  }

  private async loadRemotePrune(repoId: string, remote: string): Promise<boolean> {
    const repo = this.requireLocalRepo(repoId);
    await gitRaw(repo.localPath, ["fetch", remote, "--prune"], 60_000).catch(() => "");
    return true;
  }
}
