import type { GitHubClient, GitHubContentItem } from "../github-client.js";
import type { RepoFileContent, RepoFileEntry } from "../../../src/shared/domain/repo-code.js";

interface CacheResult<T> {
  value: T;
  cachedAt: string | null;
  fromCache: boolean;
}

export interface RepoContentReaderRepo {
  id: string;
  localPath: string | null;
  htmlUrl: string | null;
  defaultBranch: string | null;
  lastSuccessfulSyncAt: string | null;
}

export interface RepoContentReaderContext {
  repo: RepoContentReaderRepo;
  path: string;
}

export interface RepoContentReaderDependencies {
  github: GitHubClient;
  repoSyncContext(repoId: string): RepoContentReaderContext;
  cachedRepo<T>(repoId: string, cacheKey: string, ttlMs: number, load: () => Promise<T>, fallback?: () => T): Promise<CacheResult<T>>;
  localRepoFiles(repo: RepoContentReaderRepo, dirPath: string): RepoFileEntry[] | null;
  localRepoFileContent(repo: RepoContentReaderRepo, filePath: string): RepoFileContent | null;
}

const repoContentsCacheMs = 5 * 60_000;

export class RepoContentReader {
  constructor(private readonly dependencies: RepoContentReaderDependencies) {}

  async listRepoFiles(repoId: string, dirPath = ""): Promise<RepoFileEntry[]> {
    const { repo, path: apiPath } = this.dependencies.repoSyncContext(repoId);
    const cleanPath = normalizeContentPath(dirPath);
    const localFiles = this.dependencies.localRepoFiles(repo, cleanPath);
    if (localFiles) return stampItems(localFiles, repo.lastSuccessfulSyncAt, true);

    const result = await this.dependencies.cachedRepo<RepoFileEntry[]>(repoId, `files:${cleanPath}`, repoContentsCacheMs, async () => {
      const endpoint = cleanPath ? `${apiPath}/contents/${encodeGitHubPath(cleanPath)}` : `${apiPath}/contents`;
      const contents = await this.dependencies.github.get<GitHubContentItem[] | GitHubContentItem>(endpoint, {
        ref: repo.defaultBranch ?? undefined
      });
      const items = Array.isArray(contents) ? contents : [contents];

      return items.map((item) => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size ?? null,
        sha: item.sha ?? null,
        htmlUrl: item.html_url ?? null,
        downloadUrl: item.download_url ?? null
      }));
    });
    return stampItems(result.value, result.cachedAt, result.fromCache);
  }

  async readRepoFile(repoId: string, filePath: string): Promise<RepoFileContent> {
    const { repo, path: apiPath } = this.dependencies.repoSyncContext(repoId);
    const cleanPath = normalizeContentPath(filePath);
    if (!cleanPath) throw new Error("A file path is required.");

    const localFile = this.dependencies.localRepoFileContent(repo, cleanPath);
    if (localFile) return stampRepoFileContent(localFile, repo.lastSuccessfulSyncAt, true);

    const result = await this.dependencies.cachedRepo<RepoFileContent>(
      repoId,
      `file:${cleanPath}`,
      repoContentsCacheMs,
      async () => {
        const item = await this.dependencies.github.get<GitHubContentItem>(`${apiPath}/contents/${encodeGitHubPath(cleanPath)}`, {
          ref: repo.defaultBranch ?? undefined
        });
        if (item.type !== "file") throw new Error(`${cleanPath} is not a file.`);
        const bytes = item.content && item.encoding === "base64" ? Buffer.from(item.content.replace(/\s/g, ""), "base64") : null;
        const isBinary = bytes == null || hasBinaryBytes(bytes);
        return {
          name: item.name,
          path: item.path,
          contents: isBinary ? null : bytes.toString("utf8"),
          size: item.size ?? null,
          sha: item.sha ?? null,
          htmlUrl: item.html_url ?? null,
          isBinary
        };
      },
      () => ({
        name: cleanPath.split("/").pop() ?? cleanPath,
        path: cleanPath,
        contents: null,
        size: null,
        sha: null,
        htmlUrl: null,
        isBinary: true
      })
    );
    return stampRepoFileContent(result.value, result.cachedAt, result.fromCache);
  }
}

function normalizeContentPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== ".")
    .join("/");
}

function encodeGitHubPath(value: string): string {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function stampRepoFileContent(file: RepoFileContent, cachedAt: string | null, fromCache: boolean): RepoFileContent {
  return { ...file, cachedAt, fromCache };
}

function stampItems<T extends object>(
  items: T[],
  cachedAt: string | null,
  fromCache: boolean
): Array<T & { cachedAt: string | null; fromCache: boolean }> {
  return items.map((item) => ({ ...item, cachedAt, fromCache }));
}

function hasBinaryBytes(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}
