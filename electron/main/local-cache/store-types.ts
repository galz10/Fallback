import type Database from "better-sqlite3";
import type { GitHubAccountSession } from "../../../src/shared/domain/auth.js";
import type { RepoIdentityCheckStatus, RepoRemoteProtocol, RepoSigningMode } from "../../../src/shared/domain/repo-identity.js";
import type { PullRequestReviewDraftComment, PullRequestReviewEvent } from "../../../src/shared/domain/github-work.js";

export type SqliteDatabase = ReturnType<typeof Database>;

export interface GitHubAccountInput {
  id: number | string;
  login: string | null;
  endpoint?: string | null;
  htmlUrl?: string | null;
  avatarUrl: string | null;
  avatarCachedUrl?: string | null;
  name?: string | null;
  accountType?: "User" | "Organization" | null;
  tokenSource?: "environment" | "keychain" | null;
  tokenScopes?: string[] | null;
  authStatus?: GitHubAccountSession["authStatus"];
  lastValidatedAt?: string | null;
  profileName?: string | null;
  profileColor?: string | null;
}

export interface SyncJobInput {
  priority?: number;
  reason?: string | null;
  notBefore?: string | null;
  dedupeKey?: string | null;
  accountId?: string | null;
  provider?: string | null;
}

export interface RepoIdentityInput {
  accountId?: string | null;
  endpoint?: string | null;
  gitName?: string | null;
  gitEmail?: string | null;
  signingMode?: RepoSigningMode;
  signingKeyHint?: string | null;
  remoteProtocol?: RepoRemoteProtocol;
  verifiedEmailStatus?: RepoIdentityCheckStatus;
  lastCheckedAt?: string | null;
  lastCheckStatus?: RepoIdentityCheckStatus;
}

export interface PullRequestReviewDraftInput {
  headSha?: string | null;
  event?: PullRequestReviewEvent;
  body?: string;
  comments?: PullRequestReviewDraftComment[];
  reviewedFiles?: string[];
}
