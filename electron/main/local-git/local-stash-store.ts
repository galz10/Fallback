import type { WatchedRepo } from "../../../src/shared/domain/watched-repo.js";
import type { LocalChangesState, LocalStashDetail } from "../../../src/shared/domain/local-git.js";
import { gitRaw, gitText } from "../git-command.js";
import { LocalGitWorkflowBase, type LocalGitWorkflowDependencies } from "./workflow-base.js";
import {
  LocalGitConflictError,
  cleanStashRef,
  createdStashRef,
  errorMessage,
  gitStatus,
  isConflictErrorMessage,
  stashDetail,
  stashRefForSha,
  stashShaRefs,
  uniqueCleanRepoPaths
} from "./git-workflow-helpers.js";
import type { GitCommandOptions } from "./git-workflow-helpers.js";

export class LocalStashStore extends LocalGitWorkflowBase {
  constructor(deps: LocalGitWorkflowDependencies) {
    super(deps);
  }

  async stash(repoId: string, message?: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    const repo = this.requireLocalRepo(repoId);
    const trimmed = message?.trim();
    const before = await stashShaRefs(repo.localPath);
    await gitRaw(repo.localPath!, ["stash", "push", "-u", "-m", trimmed || "WIP: local changes"], 120_000, [0], options.signal);
    this.invalidateLocalChangesCache(repoId);
    const state = await this.changesOverview(repoId);
    return { ...state, createdStashRef: createdStashRef(before, await stashShaRefs(repo.localPath)) };
  }

  async stashFiles(repoId: string, paths: string[], message?: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    const repo = this.requireLocalRepo(repoId);
    const cleanPaths = uniqueCleanRepoPaths(paths);
    if (cleanPaths.length === 0) throw new Error("Select at least one changed file to stash.");

    const statusEntries = await gitStatus(repo.localPath);
    const changedPaths = new Set(
      statusEntries.flatMap((entry) => [entry.path, entry.previousPath].filter((value): value is string => Boolean(value)))
    );
    const unknownPaths = cleanPaths.filter((filePath) => !changedPaths.has(filePath));
    if (unknownPaths.length > 0) throw new Error(`Cannot stash unchanged or unknown path: ${unknownPaths[0]}`);

    const trimmed = message?.trim();
    const before = await stashShaRefs(repo.localPath);
    await gitRaw(
      repo.localPath,
      ["stash", "push", "-u", "-m", trimmed || `WIP: ${repo.name}`, "--", ...cleanPaths],
      120_000,
      [0],
      options.signal
    );
    this.invalidateLocalChangesCache(repoId);
    const state = await this.changesOverview(repoId);
    return { ...state, createdStashRef: createdStashRef(before, await stashShaRefs(repo.localPath)) };
  }

  async stashDetail(repoId: string, stashRef: string): Promise<LocalStashDetail> {
    const repo = this.requireLocalRepo(repoId);
    const ref = cleanStashRef(stashRef);
    return stashDetail(repo.localPath, ref);
  }

  async applyStash(repoId: string, stashRef: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    const repo = this.requireLocalRepo(repoId);
    const ref = cleanStashRef(stashRef);
    const detail = await stashDetail(repo.localPath, ref);
    await this.createSafetyStashForCrossBranchApply(repo, detail);
    try {
      await gitRaw(repo.localPath!, ["stash", "apply", detail.sha], 120_000, [0], options.signal);
    } catch (error) {
      if (isConflictErrorMessage(errorMessage(error))) throw new LocalGitConflictError("stash_conflict", errorMessage(error));
      throw error;
    }
    this.invalidateLocalChangesCache(repoId);
    return this.changesOverview(repoId);
  }

  async popStash(repoId: string, stashRef: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    const repo = this.requireLocalRepo(repoId);
    const ref = cleanStashRef(stashRef);
    const detail = await stashDetail(repo.localPath, ref);
    await this.createSafetyStashForCrossBranchApply(repo, detail);
    try {
      await gitRaw(repo.localPath!, ["stash", "apply", detail.sha], 120_000, [0], options.signal);
    } catch (error) {
      if (isConflictErrorMessage(errorMessage(error))) throw new LocalGitConflictError("stash_conflict", errorMessage(error));
      throw error;
    }
    const currentRef = await stashRefForSha(repo.localPath, detail.sha);
    if (currentRef) await gitRaw(repo.localPath!, ["stash", "drop", currentRef], 120_000, [0], options.signal);
    this.invalidateLocalChangesCache(repoId);
    return this.changesOverview(repoId);
  }

  async dropStash(repoId: string, stashRef: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    const repo = this.requireLocalRepo(repoId);
    await gitRaw(repo.localPath!, ["stash", "drop", cleanStashRef(stashRef)], 120_000, [0], options.signal);
    this.invalidateLocalChangesCache(repoId);
    return this.changesOverview(repoId);
  }

  private async createSafetyStashForCrossBranchApply(repo: WatchedRepo & { localPath: string }, detail: LocalStashDetail): Promise<void> {
    const [currentBranch, statusEntries] = await Promise.all([
      gitText(repo.localPath, ["branch", "--show-current"]).catch(() => repo.defaultBranch ?? "HEAD"),
      gitStatus(repo.localPath)
    ]);
    if (statusEntries.length === 0 || !detail.branch || currentBranch === detail.branch) return;
    await gitRaw(
      repo.localPath,
      ["stash", "push", "-u", "-m", `Fallback safety before applying ${detail.ref} from ${detail.branch}`],
      120_000
    );
  }
}
