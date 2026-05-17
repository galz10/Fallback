import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { DatabaseService } from "./database-service.js";
import { gitRaw, gitText } from "./git-command.js";
import { nowIso } from "./path-utils.js";
import { parseGitWorktreePorcelain } from "../../src/shared/git-worktree-parser.js";
import type { CreateRepoWorkspaceInput, RemoveRepoWorkspaceInput, RepoWorkspace } from "../../src/shared/domain/watched-repo.js";

interface GitCommandOptions {
  signal?: AbortSignal;
}

export class RepoWorkspaceService {
  constructor(private readonly database: DatabaseService) {}

  list(repoId: string): RepoWorkspace[] {
    return this.database.localCache.repoWorkspaces.listRepoWorkspaces(repoId);
  }

  async refresh(repoId: string): Promise<RepoWorkspace[]> {
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo?.localPath) return this.database.localCache.repoWorkspaces.listRepoWorkspaces(repoId);
    if (!fs.existsSync(repo.localPath)) return this.database.localCache.repoWorkspaces.listRepoWorkspaces(repoId);

    const active = this.database.localCache.repoWorkspaces.activeRepoWorkspace(repoId);
    const stdout = await gitRaw(repo.localPath, ["worktree", "list", "--porcelain"], 30_000);
    const parsed = parseGitWorktreePorcelain(stdout);
    if (parsed.length === 0) return this.database.localCache.repoWorkspaces.listRepoWorkspaces(repoId);

    const timestamp = nowIso();
    const mainWorktreePath = parsed[0]?.localPath ?? repo.localPath;
    const activePath = active?.localPath ?? repo.localPath;
    const seenIds = new Set<string>();

    for (const item of parsed) {
      const id = repoWorkspaceId(repoId, item.localPath);
      seenIds.add(id);
      const missing = !fs.existsSync(item.localPath);
      const bareOrUnavailable = item.bare || item.prunable || missing;
      const [gitCommonDir, gitDir, dirty] = bareOrUnavailable
        ? [null, null, null]
        : await Promise.all([
            gitText(item.localPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).catch(() => null),
            gitText(item.localPath, ["rev-parse", "--path-format=absolute", "--git-dir"]).catch(() => null),
            gitRaw(item.localPath, ["status", "--porcelain=v1", "--untracked-files=all"], 30_000)
              .then((value) => value.length > 0)
              .catch(() => null)
          ]);

      this.database.localCache.repoWorkspaces.upsertRepoWorkspace({
        id,
        repoId,
        kind: pathsEqual(item.localPath, mainWorktreePath) ? "clone" : "worktree",
        localPath: item.localPath,
        gitCommonDir,
        gitDir,
        mainWorktreePath,
        branch: item.branch,
        headSha: item.headSha,
        isActive: pathsEqual(item.localPath, activePath),
        isDirty: dirty,
        locked: item.locked,
        lockReason: item.lockReason,
        prunable: item.prunable,
        pruneReason: item.pruneReason,
        detached: item.detached,
        bare: item.bare,
        missing,
        lastSeenAt: timestamp
      });
    }

    for (const workspace of this.database.localCache.repoWorkspaces.listRepoWorkspaces(repoId)) {
      if (
        !seenIds.has(workspace.id) &&
        (workspace.kind === "worktree" ||
          pathsEqual(workspace.localPath, mainWorktreePath) ||
          pathsEqual(workspace.localPath, repo.localPath))
      )
        this.database.localCache.repoWorkspaces.deleteRepoWorkspace(repoId, workspace.id);
    }

    const workspaces = this.database.localCache.repoWorkspaces.listRepoWorkspaces(repoId);
    if (!workspaces.some((workspace) => workspace.isActive) && workspaces[0]) {
      this.database.localCache.repoWorkspaces.setActiveRepoWorkspace(repoId, workspaces[0].id);
    }
    return this.database.localCache.repoWorkspaces.listRepoWorkspaces(repoId);
  }

  async switch(repoId: string, workspaceId: string): Promise<RepoWorkspace> {
    await this.refresh(repoId).catch(() => this.database.localCache.repoWorkspaces.listRepoWorkspaces(repoId));
    const workspace = this.database.localCache.repoWorkspaces.getRepoWorkspace(repoId, workspaceId);
    if (!workspace) throw new Error("Workspace is not registered for this repository.");
    if (workspace.missing || workspace.prunable) throw new Error("Cannot switch to a missing or prunable workspace.");
    if (workspace.bare) throw new Error("Cannot switch to a bare workspace.");
    return this.database.localCache.repoWorkspaces.setActiveRepoWorkspace(repoId, workspaceId);
  }

  async create(repoId: string, input: CreateRepoWorkspaceInput, options: GitCommandOptions = {}): Promise<RepoWorkspace> {
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo?.localPath) throw new Error("Clone the repository before creating worktrees.");
    const basePath = repo.localPath;
    const baseRef = cleanRef(input.baseRef || repo.defaultBranch || "HEAD", "Base ref");
    const branchName = input.branchName ? cleanRef(input.branchName, "Branch name") : null;
    const targetPath = cleanTargetPath(input.path, basePath, repo.name, branchName ?? baseRef);

    const args = ["worktree", "add"];
    if (input.createBranch && branchName) args.push("-b", branchName, targetPath, baseRef);
    else if (branchName) args.push(targetPath, branchName);
    else args.push(targetPath, baseRef);

    await gitRaw(basePath, args, 120_000, [0], options.signal);
    const workspaces = await this.refresh(repoId);
    const created = workspaces.find((workspace) => pathsEqual(workspace.localPath, targetPath));
    if (!created) throw new Error("Git created the worktree, but Fallback could not register it.");
    return this.database.localCache.repoWorkspaces.setActiveRepoWorkspace(repoId, created.id);
  }

  async remove(
    repoId: string,
    workspaceId: string,
    input: RemoveRepoWorkspaceInput = {},
    options: GitCommandOptions = {}
  ): Promise<RepoWorkspace[]> {
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo?.localPath) throw new Error("Repository is not cloned locally.");
    const workspace = this.database.localCache.repoWorkspaces.getRepoWorkspace(repoId, workspaceId);
    if (!workspace) throw new Error("Workspace is not registered for this repository.");
    if (workspace.kind === "clone") throw new Error("The primary clone cannot be removed from the worktree list.");
    if (workspace.isActive) throw new Error("Switch to another workspace before removing this one.");
    if (workspace.locked && !input.force) throw new Error("This workspace is locked. Unlock it in Git or force removal.");
    if (workspace.isDirty && !input.force) throw new Error("This workspace has local changes. Stash or commit them before removing it.");

    const args = ["worktree", "remove"];
    if (input.force) args.push("--force");
    args.push(workspace.localPath);
    await gitRaw(repo.localPath, args, 120_000, [0], options.signal);
    this.database.localCache.repoWorkspaces.deleteRepoWorkspace(repoId, workspaceId);
    return this.refresh(repoId);
  }

  async prune(repoId: string, options: GitCommandOptions = {}): Promise<RepoWorkspace[]> {
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo?.localPath) throw new Error("Repository is not cloned locally.");
    await gitRaw(repo.localPath, ["worktree", "prune"], 60_000, [0], options.signal);
    return this.refresh(repoId);
  }
}

function repoWorkspaceId(repoId: string, localPath: string): string {
  return `workspace:${repoId}:${createHash("sha1").update(canonicalPath(localPath)).digest("hex").slice(0, 16)}`;
}

function pathsEqual(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right);
}

function canonicalPath(localPath: string): string {
  try {
    return fs.realpathSync(localPath);
  } catch {
    return path.resolve(localPath);
  }
}

function cleanRef(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  if (trimmed.includes("\0") || trimmed.includes("..") || trimmed.includes("[") || trimmed.startsWith("-") || /[\s~^:?*\\]/.test(trimmed)) {
    throw new Error(`${label} is not a valid Git ref name.`);
  }
  return trimmed;
}

function cleanTargetPath(value: string | undefined, basePath: string, repoName: string, ref: string): string {
  const trimmed = value?.trim();
  if (trimmed) {
    if (trimmed.includes("\0")) throw new Error("Workspace path contains an invalid character.");
    return path.resolve(basePath, "..", trimmed);
  }
  const slug = ref
    .replace(/^refs\/heads\//, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return path.resolve(basePath, "..", `${repoName}-${slug || "worktree"}`);
}
