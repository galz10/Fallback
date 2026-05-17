export interface RepoFileEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number | null;
  sha: string | null;
  htmlUrl: string | null;
  downloadUrl: string | null;
  cachedAt?: string | null;
  fromCache?: boolean;
}

export interface RepoFileContent {
  name: string;
  path: string;
  contents: string | null;
  size: number | null;
  sha: string | null;
  htmlUrl: string | null;
  isBinary: boolean;
  isTooLarge?: boolean;
  cachedAt?: string | null;
  fromCache?: boolean;
}

export interface RepoCommitSummary {
  sha: string;
  message: string;
  authorLogin: string | null;
  authorName: string | null;
  committedAt: string | null;
  htmlUrl: string | null;
  verified: boolean;
}

export interface CommitSearchInput {
  message?: string;
  author?: string;
  sha?: string;
  after?: string;
  before?: string;
  ref?: string;
  path?: string;
  limit?: number;
  timeoutMs?: number;
  requestId?: string;
}

export interface CommitSearchHit extends RepoCommitSummary {
  repoId: string;
  repoFullName: string;
  authorEmail: string | null;
  source: "git" | "cache";
  matchedPath: string | null;
}

export interface CommitSearchResult {
  repoId: string;
  repoFullName: string;
  status: "ok" | "empty" | "not_cloned" | "timeout" | "cancelled" | "error";
  source: "git" | "cache";
  message: string;
  commits: CommitSearchHit[];
  searchedAt: string;
}

export type CommitGraphStatus = "ok" | "empty" | "not_cloned" | "git_missing" | "shallow" | "stale" | "capped" | "error";

export type CommitGraphRefKind = "head" | "local_branch" | "remote_branch" | "tag" | "default_branch" | "pr" | "stash" | "other";

export interface CommitGraphRef {
  name: string;
  fullName: string;
  sha: string;
  kind: CommitGraphRefKind;
  isCurrent?: boolean;
  isDefault?: boolean;
}

export interface CommitGraphChangedFile {
  path: string;
  previousPath: string | null;
  status: string;
  additions: number | null;
  deletions: number | null;
}

export interface CommitGraphEdge {
  fromLane: number;
  toLane: number;
  parentSha: string;
  status: "loaded" | "missing";
}

export interface CommitGraphNode {
  sha: string;
  shortSha: string;
  parentShas: string[];
  lane: number;
  activeLanesBefore: number[];
  activeLanesAfter: number[];
  edges: CommitGraphEdge[];
  message: string;
  body: string;
  authorName: string | null;
  authorEmail: string | null;
  committedAt: string | null;
  refs: CommitGraphRef[];
  files: CommitGraphChangedFile[];
  htmlUrl: string | null;
  isHead: boolean;
}

export interface CommitGraphDivergence {
  defaultBranch: string | null;
  compareRef: string | null;
  ahead: number | null;
  behind: number | null;
  status: "ok" | "unknown" | "missing_default_ref" | "detached";
}

export interface CommitGraphOptions {
  limit?: number;
  sinceDays?: number;
}

export interface CommitGraphPatch {
  repoId: string;
  sha: string;
  parentSha: string | null;
  patch: string;
  generatedAt: string;
}

export interface CommitGraphViewModel {
  repoId: string;
  repoFullName: string;
  status: CommitGraphStatus;
  source: "git" | "cache";
  message: string;
  nodes: CommitGraphNode[];
  refs: CommitGraphRef[];
  stashes: CommitGraphRef[];
  headSha: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  maxLane: number;
  capped: boolean;
  shallow: boolean;
  limit: number;
  sinceDays: number;
  divergence: CommitGraphDivergence;
  generatedAt: string;
}

export interface RepoBranchSummary {
  name: string;
  sha: string | null;
  protected: boolean;
  htmlUrl: string | null;
  isDefault: boolean;
  cachedAt?: string | null;
  fromCache?: boolean;
}

export interface RepoBranchSwitchResult {
  repoId: string;
  branch: string;
  sha: string | null;
}

export interface RepoTagSummary {
  name: string;
  sha: string | null;
  tarballUrl: string | null;
  zipballUrl: string | null;
  htmlUrl: string | null;
  cachedAt?: string | null;
  fromCache?: boolean;
}

export interface RepoReleaseSummary {
  id: number;
  name: string | null;
  tagName: string;
  htmlUrl: string | null;
  draft: boolean;
  prerelease: boolean;
  createdAt: string | null;
  publishedAt: string | null;
  body: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  authorHtmlUrl: string | null;
  tarballUrl: string | null;
  zipballUrl: string | null;
  cachedAt?: string | null;
  fromCache?: boolean;
}

export interface RepoContributorSummary {
  login: string;
  avatarUrl: string | null;
  htmlUrl: string | null;
  contributions: number;
  cachedAt?: string | null;
  fromCache?: boolean;
}

export interface RepoCodeSummary {
  defaultBranch: string | null;
  latestCommit: RepoCommitSummary | null;
  commits: RepoCommitSummary[];
  branchCount: number;
  tagCount: number;
  releaseCount: number;
  contributorCount: number;
  starCount: number;
  forkCount: number;
  watcherCount: number;
  sizeKb: number | null;
  cachedBytes: number;
  totalStoredBytes: number | null;
  licenseName: string | null;
  latestReleaseName: string | null;
  cachedAt?: string | null;
  fromCache?: boolean;
}
