import fs from "node:fs";
import path from "node:path";
import type { WatchedRepo } from "../../src/shared/domain/watched-repo.js";
import type {
  CommitSearchHit,
  CommitSearchInput,
  CommitSearchResult,
  RepoCodeSummary,
  RepoCommitSummary
} from "../../src/shared/domain/repo-code.js";
import { buildCommitSearchGitLogArgs, normalizeCommitSearchInput } from "../../src/shared/commit-history-search.js";
import type { DatabaseService } from "./database-service.js";
import { gitRaw, gitText } from "./git-command.js";

export class HistorySearchService {
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly database: DatabaseService) {}

  async searchCommits(repoId: string, input: CommitSearchInput): Promise<CommitSearchResult> {
    const repo = this.database.localCache.repos.getRepo(repoId);
    if (!repo) throw new Error("Repository is not watched.");
    const search = normalizeCommitSearchInput(input);
    const searchedAt = new Date().toISOString();

    if (!repo.localPath || !fs.existsSync(path.join(repo.localPath, ".git"))) {
      return this.cachedResult(
        repo,
        search,
        searchedAt,
        "Clone this repository to search full commit history. Showing cached metadata when available."
      );
    }

    const requestId = search.requestId ?? `commit-search:${repo.id}`;
    this.cancelSearch(requestId);
    const controller = new AbortController();
    this.controllers.set(requestId, controller);

    try {
      const commits = await this.gitLog(repo, search, controller.signal);
      return {
        repoId: repo.id,
        repoFullName: repo.fullName,
        status: commits.length > 0 ? "ok" : "empty",
        source: "git",
        message: commits.length > 0 ? `Found ${commits.length} commits in local history.` : "No commits matched those filters.",
        commits,
        searchedAt
      };
    } catch (error) {
      if (isCancellationError(error)) {
        return {
          repoId: repo.id,
          repoFullName: repo.fullName,
          status: "cancelled",
          source: "git",
          message: "Commit history search was cancelled.",
          commits: [],
          searchedAt
        };
      }
      if (isTimeoutError(error)) {
        return {
          repoId: repo.id,
          repoFullName: repo.fullName,
          status: "timeout",
          source: "git",
          message: "Commit history search timed out. Narrow the filters or try a branch/path search.",
          commits: [],
          searchedAt
        };
      }
      return {
        repoId: repo.id,
        repoFullName: repo.fullName,
        status: "error",
        source: "git",
        message: error instanceof Error ? error.message : "Commit history search failed.",
        commits: [],
        searchedAt
      };
    } finally {
      if (this.controllers.get(requestId) === controller) this.controllers.delete(requestId);
    }
  }

  cancelSearch(requestId: string): boolean {
    const controller = this.controllers.get(requestId);
    if (!controller) return false;
    controller.abort();
    this.controllers.delete(requestId);
    return true;
  }

  private async gitLog(repo: WatchedRepo, input: CommitSearchInput, signal: AbortSignal): Promise<CommitSearchHit[]> {
    const resolvedSha = input.sha ? await resolveCommitSha(repo.localPath!, input.sha, input.timeoutMs, signal).catch(() => null) : null;
    const args = resolvedSha
      ? buildCommitSearchGitLogArgs({ ...input, sha: undefined, ref: resolvedSha, limit: 1 })
      : buildCommitSearchGitLogArgs(input);
    const stdout = await gitRaw(repo.localPath!, args, input.timeoutMs ?? 12_000, [0], signal);
    return parseGitLog(stdout, repo, input).filter((commit) => matchesCommit(commit, input));
  }

  private cachedResult(repo: WatchedRepo, input: CommitSearchInput, searchedAt: string, fallbackMessage: string): CommitSearchResult {
    const cached = this.database.localCache.repoMetadata.getRepoMetadataCache<RepoCodeSummary>(repo.id, "code-summary")?.payload;
    const canUseCached = !input.path && (!input.ref || input.ref === repo.defaultBranch);
    const commits = canUseCached
      ? (cached?.commits ?? []).map((commit) => cachedHit(repo, commit)).filter((commit) => matchesCommit(commit, input))
      : [];
    const status = commits.length > 0 ? "ok" : "not_cloned";
    return {
      repoId: repo.id,
      repoFullName: repo.fullName,
      status,
      source: "cache",
      message:
        commits.length > 0
          ? "Showing cached GitHub commit metadata. Clone the repository for branch, path, and full-history search."
          : input.path
            ? "Clone this repository to search commit history by path."
            : fallbackMessage,
      commits,
      searchedAt
    };
  }
}

async function resolveCommitSha(cwd: string, sha: string, timeoutMs = 12_000, signal?: AbortSignal): Promise<string> {
  return gitText(cwd, ["rev-parse", "--verify", `${sha}^{commit}`], timeoutMs, signal);
}

function parseGitLog(stdout: string, repo: WatchedRepo, input: CommitSearchInput): CommitSearchHit[] {
  return stdout
    .split("\x1e")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [sha = "", authorName = "", authorEmail = "", committedAt = "", message = ""] = row.split("\x1f");
      return {
        repoId: repo.id,
        repoFullName: repo.fullName,
        sha,
        message: message || sha,
        authorLogin: null,
        authorName: authorName || null,
        authorEmail: authorEmail || null,
        committedAt: committedAt || null,
        htmlUrl: commitHtmlUrl(repo.htmlUrl, sha),
        verified: false,
        source: "git" as const,
        matchedPath: input.path ?? null
      };
    });
}

function cachedHit(repo: WatchedRepo, commit: RepoCommitSummary): CommitSearchHit {
  return {
    ...commit,
    repoId: repo.id,
    repoFullName: repo.fullName,
    authorEmail: null,
    source: "cache",
    matchedPath: null
  };
}

function matchesCommit(commit: CommitSearchHit, input: CommitSearchInput): boolean {
  if (input.sha && !commit.sha.toLowerCase().startsWith(input.sha.toLowerCase())) return false;
  if (input.message && !commit.message.toLowerCase().includes(input.message.toLowerCase())) return false;
  if (input.author) {
    const needle = input.author.toLowerCase();
    const haystack = [commit.authorLogin, commit.authorName, commit.authorEmail].filter(Boolean).join(" ").toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  if (input.after && commit.committedAt && Date.parse(commit.committedAt) < Date.parse(input.after)) return false;
  if (input.before && commit.committedAt && Date.parse(commit.committedAt) > Date.parse(input.before)) return false;
  return true;
}

function commitHtmlUrl(repoUrl: string | null, sha: string): string | null {
  if (!repoUrl || !sha) return null;
  return `${repoUrl.replace(/\/$/, "")}/commit/${sha}`;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timeout|timed out|SIGTERM|ETIMEDOUT/i.test(error.message);
}

function isCancellationError(error: unknown): boolean {
  return error instanceof Error && /abort|cancel/i.test(`${error.name} ${error.message}`);
}
