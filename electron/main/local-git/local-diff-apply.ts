import type { LocalChangesState, LocalPatchApplyInput } from "../../../src/shared/domain/local-git.js";
import { gitRaw } from "../git-command.js";
import { LocalGitWorkflowBase, type LocalGitWorkflowDependencies } from "./workflow-base.js";
import { cleanCommitSha, cleanRepoPath, gitRawWithInput, gitStatus } from "./git-workflow-helpers.js";
import type { GitCommandOptions } from "./git-workflow-helpers.js";

export class LocalDiffApply extends LocalGitWorkflowBase {
  constructor(deps: LocalGitWorkflowDependencies) {
    super(deps);
  }

  async applyLocalPatch(repoId: string, input: LocalPatchApplyInput, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    const repo = this.requireLocalRepo(repoId);
    const cleanPath = cleanRepoPath(input.path);
    const patch = input.patch.trimEnd();
    if (!patch) throw new Error("Select a hunk or changed lines before applying a patch.");
    if (!patch.includes(` b/${cleanPath}`) && !patch.includes(`/${cleanPath}`))
      throw new Error("Patch path does not match the selected file.");
    const args =
      input.action === "stage"
        ? ["apply", "--cached", "--whitespace=nowarn", "-"]
        : input.action === "unstage"
          ? ["apply", "--cached", "--reverse", "--whitespace=nowarn", "-"]
          : ["apply", "--reverse", "--whitespace=nowarn", "-"];
    await gitRawWithInput(repo.localPath, args, `${patch}\n`, 60_000, [0], options.signal);
    this.invalidateLocalChangesCache(repoId);
    return this.changesOverview(repoId);
  }

  async stageFile(repoId: string, filePath: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    const repo = this.requireLocalRepo(repoId);
    await gitRaw(repo.localPath!, ["add", "--", cleanRepoPath(filePath)], 30_000, [0], options.signal);
    this.invalidateLocalChangesCache(repoId);
    return this.changesOverview(repoId);
  }

  async unstageFile(repoId: string, filePath: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    const repo = this.requireLocalRepo(repoId);
    await gitRaw(repo.localPath!, ["reset", "--", cleanRepoPath(filePath)], 30_000, [0], options.signal);
    this.invalidateLocalChangesCache(repoId);
    return this.changesOverview(repoId);
  }

  async stageAll(repoId: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    const repo = this.requireLocalRepo(repoId);
    await gitRaw(repo.localPath!, ["add", "-A"], 30_000, [0], options.signal);
    this.invalidateLocalChangesCache(repoId);
    return this.changesOverview(repoId);
  }

  async unstageAll(repoId: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    const repo = this.requireLocalRepo(repoId);
    await gitRaw(repo.localPath!, ["reset"], 30_000, [0], options.signal);
    this.invalidateLocalChangesCache(repoId);
    return this.changesOverview(repoId);
  }

  async discardFile(repoId: string, filePath: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    const repo = this.requireLocalRepo(repoId);
    const cleanPath = cleanRepoPath(filePath);
    const entries = await gitStatus(repo.localPath!);
    const entry = entries.find((item) => item.path === cleanPath || item.previousPath === cleanPath);
    if (!entry) return this.changesOverview(repoId);

    if (entry.previousPath) {
      await gitRaw(repo.localPath!, ["reset", "--", entry.path, entry.previousPath], 60_000, [0, 128], options.signal);
      await gitRaw(repo.localPath!, ["restore", "--source=HEAD", "--worktree", "--", entry.previousPath], 60_000, [0, 128], options.signal);
      await gitRaw(repo.localPath!, ["clean", "-fd", "--", entry.path], 60_000, [0, 1], options.signal);
      this.invalidateLocalChangesCache(repoId);
      return this.changesOverview(repoId);
    }

    if (entry.status === "untracked") {
      await gitRaw(repo.localPath!, ["clean", "-fd", "--", entry.path], 60_000, [0], options.signal);
      this.invalidateLocalChangesCache(repoId);
      return this.changesOverview(repoId);
    }

    await gitRaw(repo.localPath!, ["restore", "--staged", "--worktree", "--", entry.path], 60_000, [0, 128], options.signal);
    await gitRaw(repo.localPath!, ["clean", "-fd", "--", entry.path], 60_000, [0, 1], options.signal);
    this.invalidateLocalChangesCache(repoId);
    return this.changesOverview(repoId);
  }

  async revertCommit(repoId: string, sha: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    const repo = this.requireLocalRepo(repoId);
    const cleanSha = cleanCommitSha(sha);
    await gitRaw(repo.localPath!, ["cat-file", "-e", `${cleanSha}^{commit}`], 30_000, [0], options.signal);
    await gitRaw(repo.localPath!, ["revert", "--no-commit", cleanSha], 120_000, [0], options.signal);
    this.invalidateLocalChangesCache(repoId);
    return this.changesOverview(repoId);
  }
}
