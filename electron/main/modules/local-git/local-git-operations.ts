import { commitIdentityPolicy } from "../../../../src/shared/commit-identity-policy.js";
import fs from "node:fs";
import path from "node:path";
import type { CreateRepoWorkspaceInput, RemoveRepoWorkspaceInput } from "../../../../src/shared/domain/watched-repo.js";
import type { UpdateRepoIdentityInput } from "../../../../src/shared/domain/repo-identity.js";
import type {
  LocalCommitInput,
  LocalGitConflictAbortInput,
  LocalGitConflictResolveInput,
  LocalGitNetworkResult,
  LocalGitPublishInput,
  LocalGitPullInput,
  LocalPatchApplyInput
} from "../../../../src/shared/domain/local-git.js";
import type { AppServices } from "../../app-services.js";
import { sendAppEvent } from "../../ipc/app-events.js";
import { RepoOperationRunner } from "./repo-operation-runner.js";

export class LocalGitOperations {
  private readonly runner: RepoOperationRunner;

  constructor(private readonly services: AppServices) {
    this.runner = new RepoOperationRunner(services);
  }

  applyRepoIdentity(repoId: string) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(
        repoId,
        "apply_repo_identity",
        "normal",
        "Apply repo-local Git identity",
        "git config --local user.name/user.email <identity>",
        (context) => this.services.identity.applyLocalGitIdentity(repoId, { signal: context.signal })
      )
    );
  }

  updateRepoIdentity(repoId: string, input: UpdateRepoIdentityInput) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(
        repoId,
        "update_repo_identity",
        "normal",
        "Update repo identity",
        "git config --local user.name/user.email/commit.gpgsign <identity>",
        (context) => this.services.identity.update(repoId, input, { signal: context.signal })
      )
    );
  }

  switchWorkspace(repoId: string, workspaceId: string) {
    return this.runAndNotify(
      repoId,
      () =>
        this.runner.run(repoId, "switch_workspace", "low", "Switch active workspace", "git worktree switch", () =>
          this.services.repoWorkspaces.switch(repoId, workspaceId)
        ),
      ["repos", "localChanges", "sync", "operations"]
    );
  }

  createWorkspace(repoId: string, input: CreateRepoWorkspaceInput) {
    return this.runAndNotify(
      repoId,
      () =>
        this.runner.run(repoId, "create_workspace", "normal", "Create Git worktree", "git worktree add <path> <ref>", (context) =>
          this.services.repoWorkspaces.create(repoId, input, { signal: context.signal })
        ),
      ["repos", "localChanges", "sync", "operations"]
    );
  }

  removeWorkspace(repoId: string, workspaceId: string, input: RemoveRepoWorkspaceInput) {
    const workspace = this.services.database.localCache.repoWorkspaces.getRepoWorkspace(repoId, workspaceId);
    const risk = input.force ? "destructive" : "normal";
    return this.runAndNotify(
      repoId,
      () =>
        this.runner.run(
          repoId,
          "remove_workspace",
          risk,
          "Remove Git worktree",
          input.force ? "git worktree remove --force <path>" : "git worktree remove <path>",
          (context) => this.services.repoWorkspaces.remove(repoId, workspaceId, input, { signal: context.signal }),
          false,
          undefined,
          null,
          {
            workspaceId: workspace?.id ?? workspaceId,
            workspacePath: workspace?.localPath ?? null,
            workspaceBranch: workspace?.branch ?? null
          }
        ),
      ["repos", "localChanges", "sync", "operations"]
    );
  }

  pruneWorkspaces(repoId: string) {
    return this.runAndNotify(
      repoId,
      () =>
        this.runner.run(repoId, "prune_workspaces", "normal", "Prune stale Git worktrees", "git worktree prune", (context) =>
          this.services.repoWorkspaces.prune(repoId, { signal: context.signal })
        ),
      ["repos", "localChanges", "sync", "operations"]
    );
  }

  switchBranch(repoId: string, branch: string) {
    return this.runAndNotify(repoId, () => {
      const repo = this.services.database.localCache.repos.getRepo(repoId);
      const hasLocalWorktree = Boolean(repo?.localPath && fs.existsSync(path.join(repo.localPath, ".git")));
      return this.runner.run(
        repoId,
        "switch_branch",
        "normal",
        `Switch branch to ${branch}`,
        `git checkout <branch:${branch}>`,
        (context) => this.services.sync.switchRepoBranch(repoId, branch, { signal: context.signal }),
        hasLocalWorktree,
        undefined,
        (switchResult) => ({ resultSummary: `Switched to ${switchResult.branch}.` })
      );
    }, ["repos", "localChanges", "operations"]);
  }

  applyLocalPatch(repoId: string, input: LocalPatchApplyInput) {
    const risk = input.action === "discard" ? "destructive" : "low";
    const verb = input.action === "stage" ? "Stage" : input.action === "unstage" ? "Unstage" : "Discard";
    return this.runAndNotify(repoId, () =>
      this.runner.run(
        repoId,
        `local_patch_${input.action}`,
        risk,
        `${verb} ${input.selectionKind} in ${input.path}`,
        `git apply ${input.action === "stage" ? "--cached" : input.action === "unstage" ? "--cached --reverse" : "--reverse"} -- <patch:${input.path}>`,
        (context) => this.services.localGit.applyLocalPatch(repoId, input, { signal: context.signal }),
        input.action === "discard"
      )
    );
  }

  fetchWorkspace(repoId: string) {
    return this.runAndNotify(repoId, async () => {
      const preflight = await this.services.localGit.gitNetworkPreflight(repoId);
      const remote = preflight.upstreamRemote ?? "origin";
      return this.runner.run(
        repoId,
        "fetch_branch",
        "low",
        preflight.actionLabels.fetch,
        `git fetch --prune <remote:${remote}>`,
        (context) => this.services.localGit.fetchWorkspace(repoId, { signal: context.signal }),
        true,
        undefined,
        networkOperationResult
      );
    });
  }

  pullWorkspace(repoId: string, input: LocalGitPullInput) {
    return this.runAndNotify(repoId, async () => {
      const preflight = await this.services.localGit.gitNetworkPreflight(repoId);
      const remote = preflight.upstreamRemote ?? "origin";
      const branch = preflight.upstreamBranch ?? preflight.branch ?? "HEAD";
      const strategy = input.strategy ?? "ff-only";
      return this.runner.run(
        repoId,
        "pull_branch",
        "normal",
        preflight.actionLabels.pull,
        `git pull ${strategy === "merge" ? "--no-rebase" : strategy === "rebase" ? "--rebase" : "--ff-only"} <remote:${remote}> <branch:${branch}>`,
        (context) => this.services.localGit.pullWorkspace(repoId, input, { signal: context.signal }),
        true,
        preflight.headSha,
        networkOperationResult
      );
    });
  }

  pushWorkspace(repoId: string) {
    return this.runAndNotify(repoId, async () => {
      const preflight = await this.services.localGit.gitNetworkPreflight(repoId);
      const remote = preflight.upstreamRemote ?? "origin";
      const branch = preflight.upstreamBranch ?? preflight.branch ?? "HEAD";
      return this.runner.run(
        repoId,
        "push_branch",
        "normal",
        preflight.actionLabels.push,
        `git push <remote:${remote}> HEAD:<branch:${branch}>`,
        (context) => this.services.localGit.pushWorkspace(repoId, { signal: context.signal }),
        true,
        undefined,
        networkOperationResult
      );
    });
  }

  publishWorkspace(repoId: string, input: LocalGitPublishInput) {
    return this.runAndNotify(repoId, async () => {
      const preflight = await this.services.localGit.gitNetworkPreflight(repoId);
      const remote = input.remote ?? preflight.upstreamRemote ?? "origin";
      const branch = input.branchName ?? preflight.branch ?? "HEAD";
      return this.runner.run(
        repoId,
        "publish_branch",
        "normal",
        preflight.actionLabels.publish,
        `git push -u <remote:${remote}> HEAD:<branch:${branch}>`,
        (context) => this.services.localGit.publishWorkspace(repoId, input, { signal: context.signal }),
        true,
        undefined,
        networkOperationResult
      );
    });
  }

  abortConflict(repoId: string, input: LocalGitConflictAbortInput) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(
        repoId,
        "abort_conflict",
        "destructive",
        "Abort active Git operation",
        "git merge/rebase/cherry-pick/revert --abort",
        (context) => this.services.localGit.abortConflict(repoId, input, { signal: context.signal }),
        true,
        undefined,
        (result) => ({ resultSummary: result.isActive ? "Abort attempted; conflicts remain." : "Active Git operation aborted." })
      )
    );
  }

  openMergeTool(repoId: string, filePath: string) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(
        repoId,
        "open_merge_tool",
        "normal",
        `Open merge tool for ${filePath}`,
        `git mergetool --no-prompt -- <path:${filePath}>`,
        (context) => this.services.localGit.openMergeTool(repoId, filePath, { signal: context.signal }),
        true,
        undefined,
        (result) => ({ resultSummary: result.isActive ? `${result.fileCount} conflicted files remain.` : "Merge tool completed." })
      )
    );
  }

  resolveConflictFile(repoId: string, input: LocalGitConflictResolveInput) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(
        repoId,
        "resolve_conflict_file",
        "normal",
        `Resolve conflict in ${input.path}`,
        `write file and git add -- <path:${input.path}> when markers are gone`,
        (context) => this.services.localGit.resolveConflictFile(repoId, input, { signal: context.signal }),
        true,
        undefined,
        (result) => ({
          resultSummary: result.remainingMarkers ? `Saved partial resolution for ${input.path}.` : `Resolved and staged ${input.path}.`
        })
      )
    );
  }

  stageFile(repoId: string, filePath: string) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(repoId, "stage_file", "low", `Stage ${filePath}`, `git add -- <path:${filePath}>`, (context) =>
        this.services.localGit.stageFile(repoId, filePath, { signal: context.signal })
      )
    );
  }

  unstageFile(repoId: string, filePath: string) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(repoId, "unstage_file", "low", `Unstage ${filePath}`, `git reset -- <path:${filePath}>`, (context) =>
        this.services.localGit.unstageFile(repoId, filePath, { signal: context.signal })
      )
    );
  }

  stageAll(repoId: string) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(repoId, "stage_all", "low", "Stage all local changes", "git add -A", (context) =>
        this.services.localGit.stageAll(repoId, { signal: context.signal })
      )
    );
  }

  unstageAll(repoId: string) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(repoId, "unstage_all", "low", "Unstage all local changes", "git reset", (context) =>
        this.services.localGit.unstageAll(repoId, { signal: context.signal })
      )
    );
  }

  discardFile(repoId: string, filePath: string) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(repoId, "discard_file", "destructive", `Discard ${filePath}`, `git restore/clean -- <path:${filePath}>`, (context) =>
        this.services.localGit.discardFile(repoId, filePath, { signal: context.signal })
      )
    );
  }

  revertCommit(repoId: string, commitSha: string) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(repoId, "revert_commit", "normal", `Revert ${commitSha}`, `git revert --no-commit <sha:${commitSha}>`, (context) =>
        this.services.localGit.revertCommit(repoId, commitSha, { signal: context.signal })
      )
    );
  }

  commit(repoId: string, input: LocalCommitInput) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(repoId, "commit", "normal", `Commit: ${input.summary}`, "git commit -m <summary>", async (context) => {
        const identity = await this.services.identity.get(repoId);
        const policy = commitIdentityPolicy(identity, { bypassed: Boolean(input.bypassIdentityWarning) });
        if (policy.status !== "ok") throw new Error(`${policy.message}${policy.action ? ` ${policy.action}` : ""}`.trim());
        return this.services.localGit.commit(repoId, input, { signal: context.signal });
      })
    );
  }

  stash(repoId: string, message?: string) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(
        repoId,
        "stash",
        "normal",
        `Stash local changes${message ? `: ${message}` : ""}`,
        "git stash push -u -m <message>",
        (context) => this.services.localGit.stash(repoId, message, { signal: context.signal }),
        true,
        undefined,
        (result) => this.runner.stashOperationResult(result)
      )
    );
  }

  stashFiles(repoId: string, paths: string[], message?: string) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(
        repoId,
        "stash_files",
        "normal",
        `Stash ${paths.length} selected files${message ? `: ${message}` : ""}`,
        "git stash push -u -m <message> -- <paths>",
        (context) => this.services.localGit.stashFiles(repoId, paths, message, { signal: context.signal }),
        true,
        undefined,
        (result) => this.runner.stashOperationResult(result)
      )
    );
  }

  applyStash(repoId: string, stashRef: string) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(repoId, "apply_stash", "normal", `Apply ${stashRef}`, `git stash apply <stash:${stashRef}>`, (context) =>
        this.services.localGit.applyStash(repoId, stashRef, { signal: context.signal })
      )
    );
  }

  popStash(repoId: string, stashRef: string) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(
        repoId,
        "pop_stash",
        "normal",
        `Pop ${stashRef}`,
        `git stash pop <stash:${stashRef}>`,
        (context) => this.services.localGit.popStash(repoId, stashRef, { signal: context.signal }),
        true,
        stashRef
      )
    );
  }

  dropStash(repoId: string, stashRef: string) {
    return this.runAndNotify(repoId, () =>
      this.runner.run(repoId, "drop_stash", "destructive", `Drop ${stashRef}`, `git stash drop <stash:${stashRef}>`, (context) =>
        this.services.localGit.dropStash(repoId, stashRef, { signal: context.signal })
      )
    );
  }

  private async runAndNotify<T>(
    repoId: string,
    task: () => Promise<T>,
    events: Array<"repos" | "localChanges" | "sync" | "operations"> = ["localChanges", "repos", "operations"]
  ): Promise<T> {
    this.services.database.localCache.repos.requireRepoVisibleToActiveAccount(repoId);
    try {
      const result = await task();
      for (const event of events.filter((item) => item !== "operations")) sendAppEvent(event, { repoId });
      return result;
    } finally {
      if (events.includes("operations")) sendAppEvent("operations", { repoId });
    }
  }
}

function networkOperationResult(result: LocalGitNetworkResult): { resultSummary: string } {
  const divergence =
    result.ahead == null || result.behind == null ? "" : ` Ahead ${result.ahead}, behind ${result.behind} after ${result.action}.`;
  return { resultSummary: `${result.message}${divergence}`.trim() };
}
