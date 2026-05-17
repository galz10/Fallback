import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitHubBranch, GitHubClient, GitHubContributor, GitHubNamedRef, GitHubRelease } from "../github-client.js";
import type { DatabaseService } from "../database-service.js";
import type { WorkspaceService } from "../workspace-service.js";
import type {
  RepoBranchSummary,
  RepoBranchSwitchResult,
  RepoContributorSummary,
  RepoReleaseSummary,
  RepoTagSummary
} from "../../../src/shared/domain/repo-code.js";

interface CacheResult<T> {
  value: T;
  cachedAt: string | null;
  fromCache: boolean;
}

export interface RepoReferenceReaderRepo {
  id: string;
  owner: string;
  name: string;
  localPath: string | null;
  htmlUrl: string | null;
  defaultBranch: string | null;
}

export interface RepoReferenceReaderContext {
  repo: RepoReferenceReaderRepo;
  path: string;
}

export interface RepoReferenceReaderDependencies {
  database: DatabaseService;
  workspace: WorkspaceService;
  github: GitHubClient;
  repoSyncContext(repoId: string): RepoReferenceReaderContext;
  cachedRepo<T>(repoId: string, cacheKey: string, ttlMs: number, load: () => Promise<T>): Promise<CacheResult<T>>;
  onBranchSwitched?(result: RepoBranchSwitchResult): void;
}

const execFileAsync = promisify(execFile);
const repoReferenceCacheMs = 15 * 60_000;
const previewPages = 3;

export class RepoReferenceReader {
  constructor(private readonly dependencies: RepoReferenceReaderDependencies) {}

  async listRepoBranches(repoId: string): Promise<RepoBranchSummary[]> {
    const { repo, path: apiPath } = this.dependencies.repoSyncContext(repoId);
    const result = await this.dependencies.cachedRepo<RepoBranchSummary[]>(repoId, "branches", repoReferenceCacheMs, async () => {
      const branches = await this.dependencies.github.paginate<GitHubBranch>(`${apiPath}/branches`, {}, previewPages);
      return branches.map((branch) => ({
        name: branch.name,
        sha: branch.commit?.sha ?? null,
        protected: Boolean(branch.protected),
        htmlUrl: repo.htmlUrl ? `${repo.htmlUrl}/tree/${encodeGitHubPath(branch.name)}` : null,
        isDefault: branch.name === repo.defaultBranch
      }));
    });
    const branches = await mergeLocalBranches(repo, result.value).catch(() => result.value);
    return stampItems(branches, result.cachedAt, result.fromCache);
  }

  async switchRepoBranch(repoId: string, branch: string, options: { signal?: AbortSignal } = {}): Promise<RepoBranchSwitchResult> {
    const cleanBranch = branch.trim();
    if (!cleanBranch) throw new Error("A branch name is required.");

    const { repo } = this.dependencies.repoSyncContext(repoId);
    await gitRaw(process.cwd(), ["check-ref-format", "--branch", cleanBranch], 30_000, [0], options.signal);

    const localPath =
      repo.localPath && fs.existsSync(path.join(repo.localPath, ".git"))
        ? repo.localPath
        : await this.dependencies.workspace.ensureRepoClone(repo.owner, repo.name, null, repo.defaultBranch);
    this.dependencies.database.localCache.repos.setRepoCloneState(repoId, "cloned", localPath);

    await gitRaw(localPath, ["fetch", "--quiet", "--prune", "origin", cleanBranch], 120_000, [0], options.signal);
    const hasLocalBranch = await gitRaw(
      localPath,
      ["rev-parse", "--verify", "--quiet", `refs/heads/${cleanBranch}`],
      30_000,
      [0],
      options.signal
    )
      .then(() => true)
      .catch(() => false);

    if (hasLocalBranch) {
      await gitRaw(localPath, ["checkout", cleanBranch], 120_000, [0], options.signal);
    } else {
      await gitRaw(localPath, ["checkout", "-b", cleanBranch, "--track", `origin/${cleanBranch}`], 120_000, [0], options.signal);
    }

    const sha = await gitText(localPath, ["rev-parse", "--short", "HEAD"]).catch(() => null);
    const result = { repoId, branch: cleanBranch, sha };
    this.dependencies.onBranchSwitched?.(result);
    return result;
  }

  async listRepoTags(repoId: string): Promise<RepoTagSummary[]> {
    const { repo, path: apiPath } = this.dependencies.repoSyncContext(repoId);
    const result = await this.dependencies.cachedRepo<RepoTagSummary[]>(repoId, "tags", repoReferenceCacheMs, async () => {
      const tags = await this.dependencies.github.paginate<GitHubNamedRef>(`${apiPath}/tags`, {}, previewPages);
      return tags.map((tag) => ({
        name: tag.name,
        sha: tag.commit?.sha ?? null,
        tarballUrl: tag.tarball_url ?? null,
        zipballUrl: tag.zipball_url ?? null,
        htmlUrl: repo.htmlUrl ? `${repo.htmlUrl}/releases/tag/${encodeGitHubPath(tag.name)}` : null
      }));
    });
    return stampItems(result.value, result.cachedAt, result.fromCache);
  }

  async listRepoReleases(repoId: string): Promise<RepoReleaseSummary[]> {
    const { path: apiPath } = this.dependencies.repoSyncContext(repoId);
    const result = await this.dependencies.cachedRepo<RepoReleaseSummary[]>(repoId, "releases", repoReferenceCacheMs, async () => {
      const releases = await this.dependencies.github.paginate<GitHubRelease>(`${apiPath}/releases`, {}, previewPages);
      return releases.map((release) => ({
        id: release.id,
        name: release.name ?? null,
        tagName: release.tag_name,
        htmlUrl: release.html_url ?? null,
        draft: Boolean(release.draft),
        prerelease: Boolean(release.prerelease),
        createdAt: release.created_at ?? null,
        publishedAt: release.published_at ?? null,
        body: release.body ?? null,
        authorLogin: release.author?.login ?? null,
        authorAvatarUrl: release.author?.avatar_url ?? null,
        authorHtmlUrl: release.author?.html_url ?? null,
        tarballUrl: release.tarball_url ?? null,
        zipballUrl: release.zipball_url ?? null
      }));
    });
    return stampItems(result.value, result.cachedAt, result.fromCache);
  }

  async listRepoContributors(repoId: string): Promise<RepoContributorSummary[]> {
    const { path: apiPath } = this.dependencies.repoSyncContext(repoId);
    const result = await this.dependencies.cachedRepo<RepoContributorSummary[]>(repoId, "contributors", repoReferenceCacheMs, async () => {
      const contributors = await this.dependencies.github.paginate<GitHubContributor>(`${apiPath}/contributors`, {}, previewPages);
      return contributors.map((contributor) => ({
        login: contributor.login,
        avatarUrl: contributor.avatar_url ?? null,
        htmlUrl: contributor.html_url ?? null,
        contributions: contributor.contributions ?? 0
      }));
    });
    return stampItems(result.value, result.cachedAt, result.fromCache);
  }
}

function encodeGitHubPath(value: string): string {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function stampItems<T extends object>(
  items: T[],
  cachedAt: string | null,
  fromCache: boolean
): Array<T & { cachedAt: string | null; fromCache: boolean }> {
  return items.map((item) => ({ ...item, cachedAt, fromCache }));
}

async function mergeLocalBranches(
  repo: Pick<RepoReferenceReaderRepo, "localPath" | "defaultBranch" | "htmlUrl">,
  remoteBranches: RepoBranchSummary[]
): Promise<RepoBranchSummary[]> {
  if (!repo.localPath || !fs.existsSync(path.join(repo.localPath, ".git"))) return remoteBranches;
  const output = await gitText(repo.localPath, [
    "for-each-ref",
    "--format=%(refname:short)%00%(objectname:short)",
    "refs/heads",
    "refs/remotes/origin"
  ]);
  const byName = new Map(remoteBranches.map((branch) => [branch.name, branch]));

  for (const line of output.split("\n")) {
    if (!line) continue;
    const [rawName, sha = null] = line.split("\0");
    const name = normalizeLocalBranchName(rawName ?? "");
    if (!name) continue;
    const existing = byName.get(name);
    byName.set(name, {
      name,
      sha: existing?.sha ?? sha,
      protected: existing?.protected ?? false,
      htmlUrl: existing?.htmlUrl ?? (repo.htmlUrl ? `${repo.htmlUrl}/tree/${encodeGitHubPath(name)}` : null),
      isDefault: name === repo.defaultBranch
    });
  }

  return [...byName.values()].sort((a, b) => branchSortKey(a).localeCompare(branchSortKey(b)));
}

function normalizeLocalBranchName(value: string): string | null {
  if (!value || value === "origin/HEAD") return null;
  return value.startsWith("origin/") ? value.slice("origin/".length) : value;
}

function branchSortKey(branch: RepoBranchSummary): string {
  return branch.isDefault ? `0:${branch.name}` : `1:${branch.name}`;
}

async function gitRaw(cwd: string, args: string[], timeout = 30_000, allowExitCodes = [0], signal?: AbortSignal): Promise<string> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd,
    timeout,
    signal,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  }).catch((error: { stdout?: string; stderr?: string; code?: number }) => {
    if (error.code != null && allowExitCodes.includes(error.code)) return { stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
    throw error;
  });
  return stdout || stderr || "";
}

async function gitText(cwd: string, args: string[]): Promise<string> {
  return (await gitRaw(cwd, args)).trim();
}
