import type { RepoGroupBadge } from "./repo-group.js";
import type { SyncStatus } from "./sync.js";

export interface WatchedRepo {
  id: string;
  githubRepoId: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  ownerAvatarUrl: string | null;
  isPrivate: boolean;
  visibility: string | null;
  isFork: boolean;
  archived: boolean;
  hasIssues: boolean;
  isTemplate: boolean;
  language: string | null;
  permissions: GitHubRepoPermissions | null;
  defaultBranch: string | null;
  htmlUrl: string | null;
  localPath: string | null;
  cloneStatus: string | null;
  watchMode: "metadata-only" | "cloned";
  watchPriority: number;
  syncStatus: SyncStatus;
  syncError: string | null;
  syncProgressMessage: string | null;
  openPullRequests: number;
  openIssues: number;
  pushedAt: string | null;
  githubUpdatedAt: string | null;
  lastSyncedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  groups: RepoGroupBadge[];
}

export type RepoWorkspaceKind = "clone" | "worktree";

export interface RepoWorkspace {
  id: string;
  repoId: string;
  kind: RepoWorkspaceKind;
  localPath: string;
  gitCommonDir: string | null;
  gitDir: string | null;
  mainWorktreePath: string | null;
  branch: string | null;
  headSha: string | null;
  isActive: boolean;
  isDirty: boolean | null;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
  pruneReason: string | null;
  detached: boolean;
  bare: boolean;
  missing: boolean;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRepoWorkspaceInput {
  branchName?: string;
  baseRef?: string;
  path?: string;
  createBranch?: boolean;
}

export interface RemoveRepoWorkspaceInput {
  force?: boolean;
}

export interface WatchRepoInput {
  fullName: string;
}

export interface GitHubRepoSummary {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  ownerAvatarUrl: string | null;
  isPrivate: boolean;
  visibility: string | null;
  isFork: boolean;
  archived: boolean;
  hasIssues: boolean;
  isTemplate: boolean;
  language: string | null;
  permissions: GitHubRepoPermissions | null;
  defaultBranch: string | null;
  htmlUrl: string | null;
  pushedAt: string | null;
  githubUpdatedAt: string | null;
  cloneStatus?: string | null;
}

export interface GitHubRepoPermissions {
  admin?: boolean;
  push?: boolean;
  pull?: boolean;
}
