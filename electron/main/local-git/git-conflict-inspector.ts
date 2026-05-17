import path from "node:path";
import { writeFile } from "node:fs/promises";
import type {
  LocalGitConflictAbortInput,
  LocalGitConflictFile,
  LocalGitConflictPreflight,
  LocalGitConflictPreflightInput,
  LocalGitConflictResolveInput,
  LocalGitConflictResolveResult,
  LocalGitConflictRiskFile,
  LocalGitConflictState
} from "../../../src/shared/domain/local-git.js";
import { gitRaw, gitText } from "../git-command.js";
import { inspectRepoPath } from "../repo-path-safety.js";
import { conflictPreflightCacheMs } from "./git-command-cache.js";
import type { TimedPromiseCacheEntry } from "./git-command-cache.js";
import { LocalGitWorkflowBase, type LocalGitWorkflowDependencies } from "./workflow-base.js";
import {
  changedPathsForRef,
  cleanRepoPath,
  cleanStashRef,
  conflictFileHint,
  conflictOperationLabel,
  conflictPreflightCacheKey,
  conflictRiskLevel,
  conflictRiskSummary,
  conflictSafeAlternatives,
  conflictStateKind,
  conflictTargetRef,
  emptyConflictState,
  fileLooksRisky,
  gitNetworkPreflightFingerprint,
  gitStatus,
  stashDetail,
  uniqueStrings,
  unmergedConflictFiles
} from "./git-workflow-helpers.js";
import type { GitCommandOptions } from "./git-workflow-helpers.js";

export class GitConflictInspector extends LocalGitWorkflowBase {
  private readonly conflictPreflightCache = new Map<string, TimedPromiseCacheEntry<LocalGitConflictPreflight>>();

  constructor(deps: LocalGitWorkflowDependencies) {
    super(deps);
  }

  invalidate(repoId: string): void {
    for (const key of this.conflictPreflightCache.keys()) {
      if (key === repoId || key.startsWith(`${repoId}:`)) this.conflictPreflightCache.delete(key);
    }
  }

  async conflictPreflight(repoId: string, input: LocalGitConflictPreflightInput): Promise<LocalGitConflictPreflight> {
    const repo = this.requireLocalRepo(repoId);
    const fingerprint = await conflictPreflightFingerprint(repo.localPath, input).catch(() => `uncached:${Date.now()}`);
    const cacheKey = `${conflictPreflightCacheKey(repoId, input)}:${fingerprint}`;
    for (const key of this.conflictPreflightCache.keys()) {
      if (key !== cacheKey && key.startsWith(`${repoId}:`)) this.conflictPreflightCache.delete(key);
    }
    return this.cachedLocalGitRead(this.conflictPreflightCache, cacheKey, conflictPreflightCacheMs, () =>
      this.loadConflictPreflight(repoId, input)
    );
  }

  private async loadConflictPreflight(repoId: string, input: LocalGitConflictPreflightInput): Promise<LocalGitConflictPreflight> {
    const repo = this.requireLocalRepo(repoId);
    const [rawBranch, headSha, statusEntries, activeState, targetRef] = await Promise.all([
      gitText(repo.localPath, ["branch", "--show-current"]).catch(() => ""),
      gitText(repo.localPath, ["rev-parse", "--short", "HEAD"]).catch(() => null),
      gitStatus(repo.localPath).catch(() => []),
      conflictStateKind(repo.localPath),
      conflictTargetRef(repo.localPath, input)
    ]);
    const branch = rawBranch || null;
    const dirtyPaths = new Set(statusEntries.map((entry) => entry.path));
    const activeConflict = activeState === "none" ? emptyConflictState(repo, branch, headSha) : await this.conflictState(repoId);
    const targetPaths =
      targetRef && dirtyPaths.size > 0
        ? await changedPathsForRef(repo.localPath, targetRef).catch(() => new Set<string>())
        : new Set<string>();
    const stashPaths = input.stashRef
      ? new Set((await stashDetail(repo.localPath, cleanStashRef(input.stashRef))).files.map((file) => file.path))
      : null;
    const targetFileSet = stashPaths ?? targetPaths;
    const overlapPaths = [...dirtyPaths].filter((filePath) => targetFileSet.has(filePath));
    const riskPaths = uniqueStrings([...overlapPaths, ...[...dirtyPaths].filter((filePath) => fileLooksRisky(filePath)).slice(0, 12)]);
    const files = await Promise.all(
      riskPaths.slice(0, 25).map(async (filePath): Promise<LocalGitConflictRiskFile> => {
        const hint = await conflictFileHint(repo.localPath, filePath);
        return {
          path: filePath,
          dirty: dirtyPaths.has(filePath),
          touchedByTarget: targetFileSet.has(filePath),
          isBinary: hint.isBinary,
          isLfsPointer: hint.isLfsPointer,
          cue: hint.cue
        };
      })
    );
    const network =
      input.operation === "pull" || input.operation === "rebase" || input.operation === "merge"
        ? await this.gitNetworkPreflight(repoId)
        : null;
    const binaryFileCount = files.filter((file) => file.isBinary).length;
    const lfsFileCount = files.filter((file) => file.isLfsPointer).length;
    const staleBase = Boolean(network && (network.status === "stale" || (network.behind ?? 0) > 0));
    const diverged = Boolean(network && (network.ahead ?? 0) > 0 && (network.behind ?? 0) > 0);
    const riskLevel = conflictRiskLevel({
      activeConflict: activeConflict.isActive,
      overlapCount: overlapPaths.length,
      dirtyCount: dirtyPaths.size,
      binaryCount: binaryFileCount,
      lfsCount: lfsFileCount,
      diverged,
      operation: input.operation
    });

    return {
      repoId,
      repoFullName: repo.fullName,
      workspacePath: repo.localPath,
      branch,
      operation: input.operation,
      targetRef,
      riskLevel,
      summary: conflictRiskSummary(input.operation, riskLevel, overlapPaths.length, dirtyPaths.size, targetRef, activeConflict),
      dirtyFileCount: dirtyPaths.size,
      overlappingFileCount: overlapPaths.length,
      targetFileCount: targetFileSet.size,
      binaryFileCount,
      lfsFileCount,
      staleBase,
      diverged,
      activeConflict,
      files,
      safeAlternatives: conflictSafeAlternatives(input.operation, {
        hasDirtyFiles: dirtyPaths.size > 0,
        hasOverlap: overlapPaths.length > 0,
        activeConflict: activeConflict.isActive
      }),
      generatedAt: new Date().toISOString()
    };
  }

  async conflictState(repoId: string): Promise<LocalGitConflictState> {
    const repo = this.requireLocalRepo(repoId);
    const [branch, headSha, state, unmerged] = await Promise.all([
      gitText(repo.localPath, ["branch", "--show-current"]).catch(() => null),
      gitText(repo.localPath, ["rev-parse", "--short", "HEAD"]).catch(() => null),
      conflictStateKind(repo.localPath),
      unmergedConflictFiles(repo.localPath)
    ]);
    const files = await Promise.all(
      unmerged.map(async (file): Promise<LocalGitConflictFile> => {
        const hint = await conflictFileHint(repo.localPath, file.path);
        return { ...file, isBinary: hint.isBinary, isLfsPointer: hint.isLfsPointer, cue: hint.cue };
      })
    );
    return {
      repoId,
      repoFullName: repo.fullName,
      workspacePath: repo.localPath,
      branch,
      headSha,
      state,
      isActive: files.length > 0,
      operationLabel: conflictOperationLabel(state),
      files,
      fileCount: files.length,
      binaryCount: files.filter((file) => file.isBinary).length,
      lfsCount: files.filter((file) => file.isLfsPointer).length,
      recoveryHint:
        files.length > 0 ? "Resolve each conflicted file, stage the resolutions, then continue or abort the Git operation." : null,
      generatedAt: new Date().toISOString()
    };
  }

  async abortConflict(
    repoId: string,
    input: LocalGitConflictAbortInput = {},
    options: GitCommandOptions = {}
  ): Promise<LocalGitConflictState> {
    const repo = this.requireLocalRepo(repoId);
    const state = input.state ?? (await conflictStateKind(repo.localPath));
    if (state === "none") throw new Error("No active merge, rebase, cherry-pick, or revert is in progress.");
    const args =
      state === "rebase"
        ? ["rebase", "--abort"]
        : state === "cherry_pick"
          ? ["cherry-pick", "--abort"]
          : state === "revert"
            ? ["revert", "--abort"]
            : ["merge", "--abort"];
    await gitRaw(repo.localPath, args, 120_000, [0], options.signal);
    this.invalidateLocalChangesCache(repoId);
    return this.conflictState(repoId);
  }

  async conflictFilePath(repoId: string, filePath: string): Promise<string> {
    const repo = this.requireLocalRepo(repoId);
    const cleanPath = cleanRepoPath(filePath);
    const absolutePath = path.resolve(repo.localPath, cleanPath);
    const root = path.resolve(repo.localPath);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) throw new Error("Path is outside the repository.");
    return absolutePath;
  }

  async resolveConflictFile(
    repoId: string,
    input: LocalGitConflictResolveInput,
    options: GitCommandOptions = {}
  ): Promise<LocalGitConflictResolveResult> {
    const repo = this.requireLocalRepo(repoId);
    const cleanPath = cleanRepoPath(input.path);
    const unmerged = await gitRaw(repo.localPath, ["ls-files", "-u", "--", cleanPath], 30_000, [0], options.signal).catch(() => "");
    if (!unmerged.trim()) throw new Error("This file is not currently in an unresolved Git conflict.");

    const inspected = inspectRepoPath(repo.localPath, cleanPath);
    if (inspected.kind !== "file") throw new Error("Conflict resolution can only update a regular file inside the repository.");

    await writeFile(inspected.absolutePath, input.contents, "utf8");
    const remainingMarkers = hasConflictMarkers(input.contents);
    if (!remainingMarkers) await gitRaw(repo.localPath, ["add", "--", cleanPath], 30_000, [0], options.signal);

    this.invalidateLocalChangesCache(repoId);
    return {
      changes: await this.changesOverview(repoId),
      conflictState: await this.conflictState(repoId),
      staged: !remainingMarkers,
      remainingMarkers
    };
  }

  async openMergeTool(repoId: string, filePath: string, options: GitCommandOptions = {}): Promise<LocalGitConflictState> {
    const repo = this.requireLocalRepo(repoId);
    const cleanPath = cleanRepoPath(filePath);
    await gitRaw(repo.localPath, ["mergetool", "--no-prompt", "--", cleanPath], 300_000, [0], options.signal);
    this.invalidateLocalChangesCache(repoId);
    return this.conflictState(repoId);
  }
}

function hasConflictMarkers(contents: string): boolean {
  return contents.split(/\r?\n/).some((line) => /^(<<<<<<<|=======|>>>>>>>)(?:\s|$)/.test(line));
}

async function conflictPreflightFingerprint(cwd: string, input: LocalGitConflictPreflightInput): Promise<string> {
  const worktreeFingerprint = await gitNetworkPreflightFingerprint(cwd);
  if (!input.stashRef) return worktreeFingerprint;
  const ref = cleanStashRef(input.stashRef);
  const stashSha = await gitText(cwd, ["rev-parse", ref]).catch(() => "missing");
  return `${worktreeFingerprint}:stash:${stashSha}`;
}
