import type { WatchedRepo } from "../../src/shared/domain/watched-repo.js";
import type {
  CommitGraphChangedFile,
  CommitGraphDivergence,
  CommitGraphOptions,
  CommitGraphPatch,
  CommitGraphRef,
  CommitGraphRefKind,
  CommitGraphViewModel
} from "../../src/shared/domain/repo-code.js";
import { layoutCommitGraph } from "../../src/shared/commit-graph-layout.js";
import { gitRaw, gitText } from "./git-command.js";
import type { DatabaseService } from "./database-service.js";

const defaultLimit = 300;
const defaultSinceDays = 90;
const graphCacheTtlMs = 30_000;

interface GraphCacheEntry {
  value: CommitGraphViewModel;
  expiresAt: number;
}

interface ParsedCommit {
  sha: string;
  parentShas: string[];
  message: string;
  authorName: string | null;
  authorEmail: string | null;
  committedAt: string | null;
  files: CommitGraphChangedFile[];
}

interface CommitGraphFileStats {
  additions: number | null;
  deletions: number | null;
}

export class CommitGraphService {
  private readonly cache = new Map<string, GraphCacheEntry>();

  constructor(private readonly database: DatabaseService) {}

  async graph(repoId: string, options: CommitGraphOptions = {}): Promise<CommitGraphViewModel> {
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo) throw new Error("Repository is not watched.");

    const limit = boundedInteger(options.limit, 1, 1_000, defaultLimit);
    const sinceDays = boundedInteger(options.sinceDays, 1, 365, defaultSinceDays);
    const cacheKey = `${repoId}:${limit}:${sinceDays}`;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    if (!repo.localPath || repo.watchMode !== "cloned") {
      if (cached?.value) {
        return staleGraph(cached.value, "Showing the last commit graph because this repository is not currently cloned locally.");
      }
      return this.emptyModel(repo, {
        status: "not_cloned",
        source: "git",
        message: "Clone this repository to view its local commit graph.",
        limit,
        sinceDays
      });
    }

    if (cached && cached.expiresAt > now) return cached.value;

    try {
      const value = await this.loadGraph(repo as WatchedRepo & { localPath: string }, limit, sinceDays);
      this.cache.set(cacheKey, { value, expiresAt: now + graphCacheTtlMs });
      return value;
    } catch (error) {
      if (cached?.value) {
        return staleGraph(cached.value, `Showing the last commit graph because local Git refresh failed: ${errorMessage(error)}`);
      }
      const message = errorMessage(error);
      return this.emptyModel(repo, {
        status:
          message.includes("ENOENT") || message.includes("spawn git")
            ? "git_missing"
            : message.includes("not a git repository")
              ? "not_cloned"
              : "error",
        source: "git",
        message,
        limit,
        sinceDays
      });
    }
  }

  async patch(repoId: string, sha: string): Promise<CommitGraphPatch> {
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo) throw new Error("Repository is not watched.");
    if (!repo.localPath || repo.watchMode !== "cloned") throw new Error("Commit diffs are available for cloned repositories only.");
    const commitSha = await gitText(repo.localPath, ["rev-parse", "--verify", `${sha}^{commit}`]);
    const parentLine = await gitText(repo.localPath, ["rev-list", "--parents", "-n", "1", commitSha]);
    const parents = parentLine.split(/\s+/).filter(Boolean).slice(1);
    const parentSha = parents[0] ?? null;
    const patch = parentSha
      ? await gitRaw(repo.localPath, ["diff", "--patch", "--find-renames", parentSha, commitSha], 120_000)
      : await gitRaw(repo.localPath, ["show", "--format=", "--patch", "--find-renames", "--root", commitSha], 120_000);
    return {
      repoId,
      sha: commitSha,
      parentSha,
      patch,
      generatedAt: new Date().toISOString()
    };
  }

  private async loadGraph(repo: WatchedRepo & { localPath: string }, limit: number, sinceDays: number): Promise<CommitGraphViewModel> {
    const [headSha, currentBranch, shallow, refs, stashRefs, logOutput, numstatOutput] = await Promise.all([
      gitText(repo.localPath, ["rev-parse", "HEAD"]).catch(() => null),
      gitText(repo.localPath, ["branch", "--show-current"]).then(
        (branch) => branch || null,
        () => null
      ),
      gitText(repo.localPath, ["rev-parse", "--is-shallow-repository"]).then(
        (value) => value === "true",
        () => false
      ),
      this.loadRefs(repo),
      this.loadStashRefs(repo.localPath),
      gitRaw(repo.localPath, [
        "log",
        "--all",
        "--parents",
        "--date=iso-strict",
        `--max-count=${limit + 1}`,
        `--since=${sinceDays}.days.ago`,
        "--find-renames",
        "--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s",
        "--name-status"
      ]),
      gitRaw(repo.localPath, ["log", "--all", `--max-count=${limit + 1}`, `--since=${sinceDays}.days.ago`, "--format=%x1e%H", "--numstat"])
    ]);
    const statsByCommit = parseCommitNumstatLog(numstatOutput);
    const parsedCommits = parseCommitLog(logOutput).map((commit) => ({
      ...commit,
      files: applyFileStats(commit.files, statsByCommit.get(commit.sha))
    }));
    const capped = parsedCommits.length > limit;
    const commits = parsedCommits.slice(0, limit);
    const layout = layoutCommitGraph(commits);
    const graphRefs = refs.map((ref) =>
      currentBranch && ref.fullName === `refs/heads/${currentBranch}` ? { ...ref, isCurrent: true } : ref
    );
    const refsBySha = refsByTarget([...graphRefs, ...stashRefs, ...(headSha ? [headRef(headSha)] : [])], repo.defaultBranch);
    const nodes = commits.map((commit, index) => {
      const row = layout.rows[index];
      return {
        sha: commit.sha,
        shortSha: commit.sha.slice(0, 7),
        parentShas: commit.parentShas,
        lane: row?.lane ?? 0,
        activeLanesBefore: row?.activeLanesBefore ?? [],
        activeLanesAfter: row?.activeLanesAfter ?? [],
        edges: row?.edges ?? [],
        message: commit.message,
        body: "",
        authorName: commit.authorName,
        authorEmail: commit.authorEmail,
        committedAt: commit.committedAt,
        refs: refsBySha.get(commit.sha) ?? [],
        files: commit.files,
        htmlUrl: repo.htmlUrl ? `${repo.htmlUrl.replace(/\/$/, "")}/commit/${commit.sha}` : null,
        isHead: commit.sha === headSha
      };
    });
    const divergence = await this.loadDivergence(repo, headSha, currentBranch);
    const status = nodes.length === 0 ? "empty" : shallow ? "shallow" : capped ? "capped" : "ok";

    return {
      repoId: repo.id,
      repoFullName: repo.fullName,
      status,
      source: "git",
      message: graphStatusMessage(status, { capped, shallow, limit, sinceDays }),
      nodes,
      refs: graphRefs,
      stashes: stashRefs,
      headSha,
      currentBranch,
      defaultBranch: repo.defaultBranch,
      maxLane: layout.maxLane,
      capped,
      shallow,
      limit,
      sinceDays,
      divergence,
      generatedAt: new Date().toISOString()
    };
  }

  private async loadRefs(repo: WatchedRepo & { localPath: string }): Promise<CommitGraphRef[]> {
    const stdout = await gitRaw(repo.localPath, [
      "for-each-ref",
      "--format=%(objectname)%00%(refname)%00%(refname:short)",
      "refs/heads/",
      "refs/remotes/",
      "refs/tags/",
      "refs/pull/",
      "refs/fallback/"
    ]).catch(() => "");
    const refs: CommitGraphRef[] = [];
    for (const row of stdout.split("\n").filter(Boolean)) {
      const [sha, fullName, shortName] = row.split("\0");
      if (!sha || !fullName) continue;
      if (fullName.endsWith("/HEAD")) continue;
      refs.push({
        name: normalizeRefName(shortName || fullName),
        fullName,
        sha,
        kind: refKind(fullName),
        isCurrent: false,
        isDefault: isDefaultRef(fullName, shortName || fullName, repo.defaultBranch)
      });
    }
    return refs;
  }

  private async loadStashRefs(cwd: string): Promise<CommitGraphRef[]> {
    const stdout = await gitRaw(cwd, ["stash", "list", "--format=%H%x1f%gd%x1f%s"]).catch(() => "");
    return stdout
      .split("\n")
      .filter(Boolean)
      .slice(0, 20)
      .flatMap((row) => {
        const [sha, ref] = row.split("\x1f");
        return sha && ref
          ? [
              {
                name: ref,
                fullName: `refs/stash/${ref}`,
                sha,
                kind: "stash" as const,
                isCurrent: false,
                isDefault: false
              }
            ]
          : [];
      });
  }

  private async loadDivergence(
    repo: WatchedRepo & { localPath: string },
    headSha: string | null,
    currentBranch: string | null
  ): Promise<CommitGraphDivergence> {
    if (!headSha) {
      return { defaultBranch: repo.defaultBranch, compareRef: null, ahead: null, behind: null, status: "unknown" };
    }
    if (!currentBranch) {
      return { defaultBranch: repo.defaultBranch, compareRef: null, ahead: null, behind: null, status: "detached" };
    }
    const compareRef = await defaultCompareRef(repo);
    if (!compareRef) {
      return { defaultBranch: repo.defaultBranch, compareRef: null, ahead: null, behind: null, status: "missing_default_ref" };
    }
    const counts = await gitText(repo.localPath, ["rev-list", "--left-right", "--count", `${compareRef}...HEAD`]).catch(() => null);
    if (!counts) {
      return { defaultBranch: repo.defaultBranch, compareRef, ahead: null, behind: null, status: "unknown" };
    }
    const [behind, ahead] = counts.split(/\s+/).map((value) => Number(value));
    return {
      defaultBranch: repo.defaultBranch,
      compareRef,
      ahead: Number.isFinite(ahead) ? ahead : null,
      behind: Number.isFinite(behind) ? behind : null,
      status: "ok"
    };
  }

  private emptyModel(
    repo: WatchedRepo,
    input: Pick<CommitGraphViewModel, "status" | "source" | "message" | "limit" | "sinceDays">
  ): CommitGraphViewModel {
    return {
      repoId: repo.id,
      repoFullName: repo.fullName,
      status: input.status,
      source: input.source,
      message: input.message,
      nodes: [],
      refs: [],
      stashes: [],
      headSha: null,
      currentBranch: null,
      defaultBranch: repo.defaultBranch,
      maxLane: 0,
      capped: false,
      shallow: false,
      limit: input.limit,
      sinceDays: input.sinceDays,
      divergence: {
        defaultBranch: repo.defaultBranch,
        compareRef: null,
        ahead: null,
        behind: null,
        status: "unknown"
      },
      generatedAt: new Date().toISOString()
    };
  }
}

function parseCommitLog(stdout: string): ParsedCommit[] {
  return stdout
    .split("\x1e")
    .filter((record) => record.trim())
    .flatMap((record) => {
      const [header = "", ...fileLines] = record.replace(/^\n/, "").split("\n");
      const [sha, parents, authorName, authorEmail, committedAt, message] = header.split("\x1f");
      if (!sha) return [];
      return [
        {
          sha,
          parentShas: parents ? parents.split(" ").filter(Boolean) : [],
          message: message || "(no commit message)",
          authorName: authorName || null,
          authorEmail: authorEmail || null,
          committedAt: committedAt || null,
          files: parseNameStatus(fileLines)
        }
      ];
    });
}

function parseCommitNumstatLog(stdout: string): Map<string, Map<string, CommitGraphFileStats>> {
  const statsByCommit = new Map<string, Map<string, CommitGraphFileStats>>();
  for (const record of stdout.split("\x1e").filter((part) => part.trim())) {
    const [shaLine = "", ...statLines] = record.replace(/^\n/, "").split("\n");
    const sha = shaLine.trim();
    if (!sha) continue;
    const stats = new Map<string, CommitGraphFileStats>();
    for (const line of statLines.map((item) => item.trim()).filter(Boolean)) {
      const [additionsRaw, deletionsRaw, filePath] = line.split("\t");
      if (!filePath) continue;
      stats.set(normalizeNumstatPath(filePath), {
        additions: additionsRaw === "-" ? null : Number(additionsRaw),
        deletions: deletionsRaw === "-" ? null : Number(deletionsRaw)
      });
    }
    statsByCommit.set(sha, stats);
  }
  return statsByCommit;
}

function parseNameStatus(lines: string[]): CommitGraphChangedFile[] {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [status, firstPath, secondPath] = line.split("\t");
      if (!status || !firstPath) return [];
      const renamed = status.startsWith("R") || status.startsWith("C");
      return [
        {
          path: renamed ? (secondPath ?? firstPath) : firstPath,
          previousPath: renamed ? firstPath : null,
          status,
          additions: null,
          deletions: null
        }
      ];
    });
}

function applyFileStats(files: CommitGraphChangedFile[], stats: Map<string, CommitGraphFileStats> | undefined): CommitGraphChangedFile[] {
  if (!stats) return files;
  return files.map((file) => {
    const fileStats = stats.get(file.path) ?? (file.previousPath ? stats.get(file.previousPath) : undefined);
    return fileStats ? { ...file, additions: fileStats.additions, deletions: fileStats.deletions } : file;
  });
}

function normalizeNumstatPath(filePath: string): string {
  const arrowMatch = /^(.*)\{(.+) => (.+)\}(.*)$/.exec(filePath);
  if (!arrowMatch) return filePath;
  return `${arrowMatch[1]}${arrowMatch[3]}${arrowMatch[4]}`;
}

function refsByTarget(refs: CommitGraphRef[], defaultBranch: string | null): Map<string, CommitGraphRef[]> {
  const bySha = new Map<string, CommitGraphRef[]>();
  for (const ref of refs) {
    const list = bySha.get(ref.sha) ?? [];
    list.push(ref);
    bySha.set(ref.sha, list);
  }
  for (const list of bySha.values()) {
    list.sort((a, b) => refRank(a, defaultBranch) - refRank(b, defaultBranch) || a.name.localeCompare(b.name));
  }
  return bySha;
}

function headRef(sha: string): CommitGraphRef {
  return { name: "HEAD", fullName: "HEAD", sha, kind: "head", isCurrent: true, isDefault: false };
}

function refKind(fullName: string): CommitGraphRefKind {
  if (fullName.startsWith("refs/heads/")) return "local_branch";
  if (fullName.startsWith("refs/remotes/")) return "remote_branch";
  if (fullName.startsWith("refs/tags/")) return "tag";
  if (fullName.startsWith("refs/pull/") || fullName.includes("/pull/")) return "pr";
  if (fullName.startsWith("refs/stash/")) return "stash";
  return "other";
}

function normalizeRefName(name: string): string {
  return name.replace(/^origin\//, "origin/");
}

function isDefaultRef(fullName: string, name: string, defaultBranch: string | null): boolean {
  if (!defaultBranch) return false;
  return fullName === `refs/heads/${defaultBranch}` || name === `origin/${defaultBranch}` || name === defaultBranch;
}

function refRank(ref: CommitGraphRef, defaultBranch: string | null): number {
  if (ref.kind === "head") return 0;
  if (ref.isDefault || ref.name === defaultBranch || ref.name === `origin/${defaultBranch}`) return 1;
  if (ref.kind === "local_branch") return 2;
  if (ref.kind === "remote_branch") return 3;
  if (ref.kind === "tag") return 4;
  if (ref.kind === "pr") return 5;
  if (ref.kind === "stash") return 6;
  return 7;
}

async function defaultCompareRef(repo: WatchedRepo & { localPath: string }): Promise<string | null> {
  if (!repo.defaultBranch) return null;
  const candidates = [`origin/${repo.defaultBranch}`, repo.defaultBranch];
  for (const ref of candidates) {
    const exists = await gitText(repo.localPath, ["rev-parse", "--verify", `${ref}^{commit}`]).catch(() => null);
    if (exists) return ref;
  }
  return null;
}

function boundedInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function graphStatusMessage(
  status: CommitGraphViewModel["status"],
  input: { capped: boolean; shallow: boolean; limit: number; sinceDays: number }
): string {
  if (status === "empty") return `No commits found in the last ${input.sinceDays} days.`;
  if (input.shallow) return "This repository is shallow, so older graph edges may stop early.";
  if (input.capped) return `Showing the newest ${input.limit} commits. Refine the filters or fetch deeper history for more.`;
  return "Commit graph loaded from local Git.";
}

function staleGraph(value: CommitGraphViewModel, message: string): CommitGraphViewModel {
  return {
    ...value,
    status: "stale",
    source: "cache",
    message,
    generatedAt: new Date().toISOString()
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
