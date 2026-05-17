import type { GitHubRepoSummary, WatchedRepo } from "./domain/watched-repo.js";
import type { LocalChangesSummary } from "./domain/local-git.js";
import type { SyncStatus } from "./domain/sync.js";

export type RepoDisplayMode = "cards" | "list";
export type RepoSortMode = "attention" | "updated" | "name" | "syncStatus";
export type RepoHomeViewMode = "watched" | "available" | "recent" | "private" | "attention" | "local" | "failed";
export type RepoVisibilityFilter = "all" | "private" | "public";
export type RepoWatchFilter = "all" | "watched" | "unwatched";
export type RepoKindFilter = "all" | "forks" | "archives" | "templates" | "sources";

export interface AvailableRepoFilters {
  query?: string;
  owner?: string;
  visibility?: RepoVisibilityFilter;
  watch?: RepoWatchFilter;
  kind?: RepoKindFilter;
  recentOnly?: boolean;
}

export interface WatchedRepoFilters {
  query?: string;
  view?: RepoHomeViewMode;
  groupId?: string | null;
  localChanges?: ReadonlyMap<string, LocalChangesSummary>;
}

export function filterAvailableRepos(
  repos: GitHubRepoSummary[],
  watchedRepos: Array<Pick<WatchedRepo, "fullName">>,
  filters: AvailableRepoFilters = {}
): GitHubRepoSummary[] {
  const watchedNames = new Set(watchedRepos.map((repo) => repo.fullName.toLowerCase()));
  const query = normalizeQuery(filters.query);
  const owner = filters.owner?.trim().toLowerCase() ?? "";
  const visibility = filters.visibility ?? "all";
  const watch = filters.watch ?? "all";
  const kind = filters.kind ?? "all";

  return repos.filter((repo) => {
    const watched = watchedNames.has(repo.fullName.toLowerCase());
    if (query && !repoMatchesQuery(repo, query)) return false;
    if (owner && repo.owner.toLowerCase() !== owner) return false;
    if (visibility === "private" && !repo.isPrivate) return false;
    if (visibility === "public" && repo.isPrivate) return false;
    if (watch === "watched" && !watched) return false;
    if (watch === "unwatched" && watched) return false;
    if (kind === "forks" && !repo.isFork) return false;
    if (kind === "archives" && !repo.archived) return false;
    if (kind === "templates" && !repo.isTemplate) return false;
    if (kind === "sources" && (repo.isFork || repo.archived || repo.isTemplate)) return false;
    if (filters.recentOnly && !isRecentlyPushed(repo.pushedAt ?? repo.githubUpdatedAt)) return false;
    return true;
  });
}

export function filterWatchedRepos(repos: WatchedRepo[], filters: WatchedRepoFilters = {}): WatchedRepo[] {
  const query = normalizeQuery(filters.query);
  const view = filters.view ?? "watched";
  const groupId = filters.groupId ?? null;
  return repos.filter((repo) => {
    if (query && !repoMatchesQuery(repo, query)) return false;
    if (groupId && !repo.groups.some((group) => group.id === groupId)) return false;
    if (view === "private" && !repo.isPrivate) return false;
    const changes = filters.localChanges?.get(repo.id);
    if (view === "attention" && repoAttentionScore(repo, changes) === 0) return false;
    if (view === "local" && !changes?.isDirty) return false;
    if (view === "failed" && !syncNeedsAttention(repo.syncStatus)) return false;
    if (view === "recent" && !isRecentlyPushed(repo.pushedAt ?? repo.githubUpdatedAt ?? repo.lastSuccessfulSyncAt)) return false;
    return view !== "available";
  });
}

export function sortWatchedRepos(
  repos: WatchedRepo[],
  mode: RepoSortMode,
  localChanges?: ReadonlyMap<string, LocalChangesSummary>
): WatchedRepo[] {
  return [...repos].sort((a, b) => {
    if (mode === "name") return a.fullName.localeCompare(b.fullName);
    if (mode === "syncStatus") {
      const status = syncStatusWeight(b.syncStatus) - syncStatusWeight(a.syncStatus);
      return status || a.fullName.localeCompare(b.fullName);
    }
    if (mode === "updated") {
      const updated =
        timestampValue(b.pushedAt ?? b.githubUpdatedAt ?? b.lastSuccessfulSyncAt) -
        timestampValue(a.pushedAt ?? a.githubUpdatedAt ?? a.lastSuccessfulSyncAt);
      return updated || a.fullName.localeCompare(b.fullName);
    }
    const attention = repoAttentionScore(b, localChanges?.get(b.id)) - repoAttentionScore(a, localChanges?.get(a.id));
    if (attention) return attention;
    const updated =
      timestampValue(b.pushedAt ?? b.githubUpdatedAt ?? b.lastSuccessfulSyncAt) -
      timestampValue(a.pushedAt ?? a.githubUpdatedAt ?? a.lastSuccessfulSyncAt);
    return updated || a.fullName.localeCompare(b.fullName);
  });
}

export function repoAttentionScore(
  repo: Pick<WatchedRepo, "syncStatus" | "syncError" | "openPullRequests" | "openIssues" | "lastSuccessfulSyncAt">,
  localChanges?: Pick<LocalChangesSummary, "isDirty" | "fileCount" | "error"> | null
): number {
  let score = syncStatusWeight(repo.syncStatus);
  if (repo.syncError) score += 2;
  if (localChanges?.isDirty) score += Math.min(5, Math.max(2, localChanges.fileCount));
  if (localChanges?.error) score += 1;
  if (repo.openPullRequests > 0) score += Math.min(4, repo.openPullRequests);
  if (repo.openIssues > 0) score += Math.min(3, Math.ceil(repo.openIssues / 5));
  if (!repo.lastSuccessfulSyncAt) score += 2;
  else if (isStaleIso(repo.lastSuccessfulSyncAt, 7)) score += 1;
  return score;
}

export function repoAttentionLabels(
  repo: Pick<
    WatchedRepo,
    "syncStatus" | "syncError" | "openPullRequests" | "openIssues" | "lastSuccessfulSyncAt" | "localPath" | "watchMode" | "cloneStatus"
  >,
  localChanges?: Pick<LocalChangesSummary, "isDirty" | "fileCount" | "additions" | "deletions" | "error"> | null
): string[] {
  const labels: string[] = [];
  if (syncNeedsAttention(repo.syncStatus)) labels.push(syncStatusLabel(repo.syncStatus));
  if (!repo.lastSuccessfulSyncAt) labels.push("Never synced");
  else if (isStaleIso(repo.lastSuccessfulSyncAt, 7)) labels.push("Stale cache");
  if (repo.openPullRequests > 0) labels.push(`${repo.openPullRequests} open PR${repo.openPullRequests === 1 ? "" : "s"}`);
  if (repo.openIssues > 0) labels.push(`${repo.openIssues} open issue${repo.openIssues === 1 ? "" : "s"}`);
  if (localChanges?.isDirty) labels.push(localChanges.fileCount === 1 ? "1 local change" : `${localChanges.fileCount} local changes`);
  else if (localChanges?.error) labels.push("Local changes unavailable");
  if (repo.watchMode === "cloned" || repo.cloneStatus === "cloned" || repo.localPath)
    labels.push(repo.cloneStatus === "failed" ? "Clone failed" : "Local");
  return labels;
}

export function availableRepoOwners(repos: GitHubRepoSummary[]): string[] {
  return [...new Set(repos.map((repo) => repo.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function syncNeedsAttention(status: SyncStatus): boolean {
  return status === "failed" || status === "auth_error" || status === "rate_limited" || status === "offline";
}

function repoMatchesQuery(
  repo: Pick<GitHubRepoSummary, "fullName" | "description" | "language" | "defaultBranch">,
  query: string
): boolean {
  return [repo.fullName, repo.description, repo.language, repo.defaultBranch].some((value) => (value ?? "").toLowerCase().includes(query));
}

function normalizeQuery(query: string | undefined): string {
  return query?.trim().toLowerCase() ?? "";
}

function isRecentlyPushed(value: string | null | undefined): boolean {
  return value ? !isStaleIso(value, 30) : false;
}

function isStaleIso(value: string, days: number): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Date.now() - timestamp > days * 24 * 60 * 60 * 1000 : false;
}

function timestampValue(value: string | null | undefined): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function syncStatusWeight(status: SyncStatus): number {
  switch (status) {
    case "auth_error":
      return 10;
    case "failed":
      return 9;
    case "rate_limited":
      return 8;
    case "offline":
      return 7;
    case "syncing":
      return 5;
    case "queued":
      return 4;
    case "stale":
      return 3;
    case "never_synced":
      return 2;
    case "fresh":
      return 0;
    default:
      return 0;
  }
}

function syncStatusLabel(status: SyncStatus): string {
  return status.replaceAll("_", " ");
}
