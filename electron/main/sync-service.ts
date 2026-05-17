import type { AttentionService } from "./attention-service.js";
import type { BranchIntegrityService } from "./branch-integrity-service.js";
import type { DatabaseService } from "./database-service.js";
import type { GitHubClient } from "./github-client.js";
import type { SettingsService } from "./settings-service.js";
import type { TokenService } from "./token-service.js";
import type { WorkspaceService } from "./workspace-service.js";
import type { SubmitPullRequestReviewInput } from "../../src/shared/domain/github-work.js";
import type { RepoBranchSwitchResult, RepoCodeSummary, RepoFileContent, RepoFileEntry } from "../../src/shared/domain/repo-code.js";
import type { SyncJob } from "../../src/shared/domain/sync.js";
import { SyncServiceRuntime, type EnqueueSyncOptions, type SyncServiceCallbacks } from "./sync/sync-service-runtime.js";

export { branchIntegritySyncDecision } from "./sync/branch-integrity-sync-follow-up.js";
export type { BranchIntegritySyncDecision, BranchIntegritySyncDecisionInput } from "./sync/branch-integrity-sync-follow-up.js";
export type { EnqueueSyncOptions, SyncServiceCallbacks } from "./sync/sync-service-runtime.js";

export class SyncService {
  private readonly runtime: SyncServiceRuntime;

  constructor(
    database: DatabaseService,
    workspace: WorkspaceService,
    github: GitHubClient,
    settings?: SettingsService,
    branchIntegrity?: BranchIntegrityService,
    attention?: AttentionService,
    callbacks: SyncServiceCallbacks = {},
    token?: TokenService
  ) {
    this.runtime = new SyncServiceRuntime(database, workspace, github, settings, branchIntegrity, attention, callbacks, token);
  }

  get queue(): unknown[] {
    const runtime = this.runtime as unknown as { syncQueue?: { queue?: unknown[] }; queue?: unknown[] };
    return runtime.syncQueue?.queue ?? runtime.queue ?? [];
  }

  get processing(): boolean {
    const runtime = this.runtime as unknown as { syncQueue?: { processing?: boolean }; processing?: boolean };
    return Boolean(runtime.syncQueue?.processing ?? runtime.processing);
  }

  watchRepo(fullNameInput: string) {
    return this.runtime.watchRepo(fullNameInput);
  }

  listAvailableRepos() {
    return this.runtime.listAvailableRepos();
  }

  repoCodeSummary(repoId: string): Promise<RepoCodeSummary> {
    return this.runtime.repoCodeSummary(repoId);
  }

  listRepoFiles(repoId: string, dirPath?: string): Promise<RepoFileEntry[]> {
    return this.runtime.listRepoFiles(repoId, dirPath);
  }

  readRepoFile(repoId: string, filePath: string): Promise<RepoFileContent> {
    return this.runtime.readRepoFile(repoId, filePath);
  }

  pullRequestDiff(repoId: string, number: number) {
    return this.runtime.pullRequestDiff(repoId, number);
  }

  addIssueComment(repoId: string, number: number, body: string): Promise<void> {
    return this.runtime.addIssueComment(repoId, number, body);
  }

  addPullRequestComment(repoId: string, number: number, body: string): Promise<void> {
    return this.runtime.addPullRequestComment(repoId, number, body);
  }

  submitPullRequestReview(repoId: string, number: number, input: SubmitPullRequestReviewInput): Promise<void> {
    return this.runtime.submitPullRequestReview(repoId, number, input);
  }

  listRepoBranches(repoId: string) {
    return this.runtime.listRepoBranches(repoId);
  }

  switchRepoBranch(repoId: string, branch: string, options: { signal?: AbortSignal } = {}): Promise<RepoBranchSwitchResult> {
    return this.runtime.switchRepoBranch(repoId, branch, options);
  }

  listRepoTags(repoId: string) {
    return this.runtime.listRepoTags(repoId);
  }

  listRepoReleases(repoId: string) {
    return this.runtime.listRepoReleases(repoId);
  }

  listRepoContributors(repoId: string) {
    return this.runtime.listRepoContributors(repoId);
  }

  enqueueRepoSync(repoId: string, jobType = "repo_sync", options: EnqueueSyncOptions = {}): Promise<SyncJob> {
    return this.runtime.enqueueRepoSync(repoId, jobType, options);
  }

  enqueueWatchedRepos(jobType = "background_repo_sync"): Promise<SyncJob[]> {
    return this.runtime.enqueueWatchedRepos(jobType);
  }

  isRateLimited(): boolean {
    return this.runtime.isRateLimited();
  }

  isRateLimitLow(): boolean {
    return this.runtime.isRateLimitLow();
  }

  syncRepo(repoIdOrFullName: string, jobId?: string) {
    return this.runtime.syncRepo(repoIdOrFullName, jobId);
  }

  syncPullRequest(repoId: string, number: number): Promise<SyncJob> {
    return this.runtime.syncPullRequest(repoId, number);
  }

  syncIssue(repoId: string, number: number): Promise<SyncJob> {
    return this.runtime.syncIssue(repoId, number);
  }

  syncUserPullRequests(options: EnqueueSyncOptions = {}): Promise<SyncJob> {
    return this.runtime.syncUserPullRequests(options);
  }
}
