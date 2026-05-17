import type { GitHubIssue, GitHubLabel, GitHubPullRequest, GitHubRepo, GitHubUser } from "../github-client.js";
import type { WatchedRepo } from "../../../src/shared/domain/watched-repo.js";
import type { SyncJob } from "../../../src/shared/domain/sync.js";

export interface RepoSyncContext {
  job: SyncJob;
  repoId: string;
  fullName: string;
  owner: string;
  name: string;
  apiPath: string;
  knownRepo: WatchedRepo | null;
  startedAt: string;
}

export interface RepoSyncMetadata {
  repo: GitHubRepo;
  localPath: string;
  viewer: GitHubUser | null;
  since: string | undefined;
}

export interface RepoSyncGitHubWork {
  allIssues: GitHubIssue[];
  allPullRequests: GitHubPullRequest[];
  labels: GitHubLabel[];
  userPullRequestNumbers: Set<number>;
  pullRequestRefreshByNumber: Map<number, boolean>;
  issueRefreshByNumber: Map<number, boolean>;
}

export interface PullRequestPatchRef {
  baseSha: string | null;
  headSha: string | null;
  baseBranch: string | null;
  headBranch: string | null;
}

export interface PullRequestDiffWarmTarget extends PullRequestPatchRef {
  number: number;
}
