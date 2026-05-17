import assert from "node:assert/strict";
import {
  filterAvailableRepos,
  filterWatchedRepos,
  repoAttentionLabels,
  repoAttentionScore,
  sortWatchedRepos
} from "../src/shared/repo-display.js";
import type { LocalChangesSummary } from "../src/shared/domain/local-git.js";
import type { GitHubRepoSummary, WatchedRepo } from "../src/shared/domain/watched-repo.js";

const availableRepos: GitHubRepoSummary[] = [
  repoSummary({
    id: 1,
    owner: "octo",
    name: "web",
    description: "React app",
    isPrivate: true,
    visibility: "private",
    language: "TypeScript",
    pushedAt: "2099-01-10T00:00:00Z"
  }),
  repoSummary({
    id: 2,
    owner: "hub",
    name: "api",
    description: "Service",
    isFork: true,
    language: "Go",
    pushedAt: "2020-01-10T00:00:00Z"
  }),
  repoSummary({
    id: 3,
    owner: "octo",
    name: "template",
    isTemplate: true,
    archived: true,
    pushedAt: "2099-02-10T00:00:00Z"
  })
];

const watchedRepos: WatchedRepo[] = [
  watchedRepo({
    id: "repo-a",
    fullName: "octo/web",
    syncStatus: "fresh",
    openPullRequests: 1,
    openIssues: 0,
    pushedAt: "2099-01-10T00:00:00Z",
    lastSuccessfulSyncAt: "2099-01-10T00:00:00Z"
  }),
  watchedRepo({
    id: "repo-b",
    fullName: "hub/api",
    syncStatus: "failed",
    syncError: "boom",
    openPullRequests: 0,
    openIssues: 8,
    pushedAt: "2020-01-10T00:00:00Z",
    lastSuccessfulSyncAt: "2020-01-10T00:00:00Z"
  }),
  watchedRepo({
    id: "repo-c",
    fullName: "octo/local",
    syncStatus: "stale",
    openPullRequests: 0,
    openIssues: 0,
    localPath: "/tmp/octo/local",
    watchMode: "cloned",
    cloneStatus: "cloned",
    groups: [{ id: "group-local", name: "Local" }]
  })
];
const localChanges = new Map<string, LocalChangesSummary>([
  [
    "repo-c",
    {
      repoId: "repo-c",
      branch: "main",
      isDirty: true,
      fileCount: 2,
      additions: 4,
      deletions: 1,
      error: null
    }
  ]
]);

assert.deepEqual(
  filterAvailableRepos(availableRepos, watchedRepos, { query: "react", visibility: "private" }).map((repo) => repo.fullName),
  ["octo/web"]
);
assert.deepEqual(
  filterAvailableRepos(availableRepos, watchedRepos, { owner: "octo", watch: "unwatched" }).map((repo) => repo.fullName),
  ["octo/template"]
);
assert.deepEqual(
  filterAvailableRepos(availableRepos, watchedRepos, { kind: "forks" }).map((repo) => repo.fullName),
  ["hub/api"]
);
assert.deepEqual(
  filterAvailableRepos(availableRepos, watchedRepos, { recentOnly: true }).map((repo) => repo.fullName),
  ["octo/web", "octo/template"]
);

assert.deepEqual(
  sortWatchedRepos(watchedRepos, "attention", localChanges).map((repo) => repo.fullName),
  ["hub/api", "octo/local", "octo/web"]
);
assert.deepEqual(
  sortWatchedRepos(watchedRepos, "updated").map((repo) => repo.fullName),
  ["octo/web", "hub/api", "octo/local"]
);
assert.deepEqual(
  filterWatchedRepos(watchedRepos, { view: "failed" }).map((repo) => repo.fullName),
  ["hub/api"]
);
assert.deepEqual(
  filterWatchedRepos(watchedRepos, { view: "local", localChanges }).map((repo) => repo.fullName),
  ["octo/local"]
);
assert.deepEqual(
  filterWatchedRepos(watchedRepos, { view: "local", localChanges: new Map() }).map((repo) => repo.fullName),
  []
);
assert.deepEqual(
  filterWatchedRepos(watchedRepos, { groupId: "group-local" }).map((repo) => repo.fullName),
  ["octo/local"]
);
assert.ok(repoAttentionScore(watchedRepos[1]!) > repoAttentionScore(watchedRepos[0]!));
assert.ok(repoAttentionScore(watchedRepos[2]!, localChanges.get("repo-c")) > repoAttentionScore(watchedRepos[2]!));
assert.deepEqual(repoAttentionLabels(watchedRepos[1]!).slice(0, 2), ["failed", "Stale cache"]);
assert.ok(repoAttentionLabels(watchedRepos[2]!, localChanges.get("repo-c")).includes("2 local changes"));

console.log("Repository display filters and sorting tests ok");

function repoSummary(patch: Partial<GitHubRepoSummary> & Pick<GitHubRepoSummary, "id" | "owner" | "name">): GitHubRepoSummary {
  return {
    id: patch.id,
    owner: patch.owner,
    name: patch.name,
    fullName: patch.fullName ?? `${patch.owner}/${patch.name}`,
    description: patch.description ?? null,
    ownerAvatarUrl: patch.ownerAvatarUrl ?? null,
    isPrivate: patch.isPrivate ?? false,
    visibility: patch.visibility ?? "public",
    isFork: patch.isFork ?? false,
    archived: patch.archived ?? false,
    hasIssues: patch.hasIssues ?? true,
    isTemplate: patch.isTemplate ?? false,
    language: patch.language ?? null,
    permissions: patch.permissions ?? null,
    defaultBranch: patch.defaultBranch ?? "main",
    htmlUrl: patch.htmlUrl ?? `https://github.com/${patch.owner}/${patch.name}`,
    pushedAt: patch.pushedAt ?? null,
    githubUpdatedAt: patch.githubUpdatedAt ?? null,
    cloneStatus: patch.cloneStatus ?? null
  };
}

function watchedRepo(patch: Partial<WatchedRepo> & Pick<WatchedRepo, "id" | "fullName">): WatchedRepo {
  const [owner = "octo", name = "repo"] = patch.fullName.split("/");
  return {
    id: patch.id,
    githubRepoId: patch.githubRepoId ?? (Number(patch.id.replace(/\D/g, "")) || 1),
    owner,
    name,
    fullName: patch.fullName,
    description: patch.description ?? null,
    ownerAvatarUrl: patch.ownerAvatarUrl ?? null,
    isPrivate: patch.isPrivate ?? false,
    visibility: patch.visibility ?? "public",
    isFork: patch.isFork ?? false,
    archived: patch.archived ?? false,
    hasIssues: patch.hasIssues ?? true,
    isTemplate: patch.isTemplate ?? false,
    language: patch.language ?? null,
    permissions: patch.permissions ?? null,
    defaultBranch: patch.defaultBranch ?? "main",
    htmlUrl: patch.htmlUrl ?? null,
    localPath: patch.localPath ?? null,
    cloneStatus: patch.cloneStatus ?? "not_cloned",
    watchMode: patch.watchMode ?? "metadata-only",
    watchPriority: patch.watchPriority ?? 0,
    syncStatus: patch.syncStatus ?? "fresh",
    syncError: patch.syncError ?? null,
    syncProgressMessage: patch.syncProgressMessage ?? null,
    openPullRequests: patch.openPullRequests ?? 0,
    openIssues: patch.openIssues ?? 0,
    pushedAt: patch.pushedAt ?? null,
    githubUpdatedAt: patch.githubUpdatedAt ?? null,
    lastSyncedAt: patch.lastSyncedAt ?? null,
    lastSuccessfulSyncAt: patch.lastSuccessfulSyncAt ?? null,
    groups: patch.groups ?? []
  };
}
