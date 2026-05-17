import type { SyncJob } from "../../../src/shared/domain/sync.js";
import type { RepoSyncContext, RepoSyncGitHubWork, RepoSyncMetadata } from "./repo-sync-context.js";

export type RepoSyncStagePolicy = "required" | "optional";

export interface RepoSyncPipelineDelegate {
  latestSyncJob(jobId: string): SyncJob;
  prepareRepoSync(context: RepoSyncContext): Promise<void> | void;
  refreshLocalRemoteState(context: RepoSyncContext): Promise<void>;
  syncRepoMetadata(context: RepoSyncContext): Promise<RepoSyncMetadata>;
  warmCodeCache(context: RepoSyncContext, metadata: RepoSyncMetadata): Promise<void>;
  hydrateGitHubWork(context: RepoSyncContext, metadata: RepoSyncMetadata): Promise<RepoSyncGitHubWork>;
  hydrateIssueAndPullRequestRelations(context: RepoSyncContext, work: RepoSyncGitHubWork): Promise<void>;
  warmPullRequestDiffCache(context: RepoSyncContext, work: RepoSyncGitHubWork): Promise<void>;
  syncWorkflowRuns(context: RepoSyncContext): Promise<void>;
  pruneClosedIssueCache(context: RepoSyncContext): Promise<void> | void;
  rebuildRepoSearch(context: RepoSyncContext): Promise<void> | void;
  deriveRepoAttention(context: RepoSyncContext): Promise<void> | void;
  recordBranchIntegrityAfterSync(context: RepoSyncContext): Promise<void>;
  recordSuccessfulRepoSync(context: RepoSyncContext): Promise<void> | void;
  recordFailedRepoSync(context: RepoSyncContext, error: unknown): Promise<void> | void;
  recordOptionalStageFailure?(context: RepoSyncContext, stage: string, error: unknown): Promise<void> | void;
}

export class RepoSyncPipeline {
  constructor(private readonly delegate: RepoSyncPipelineDelegate) {}

  async run(context: RepoSyncContext): Promise<SyncJob> {
    try {
      await this.runStage(context, "prepareRepoSync", "required", () => this.delegate.prepareRepoSync(context));
      await this.runStage(context, "refreshLocalRemoteState", "optional", () => this.delegate.refreshLocalRemoteState(context));
      const metadata = await this.runStage(context, "syncRepoMetadata", "required", () => this.delegate.syncRepoMetadata(context));
      await this.runStage(context, "warmCodeCache", "required", () => this.delegate.warmCodeCache(context, metadata));
      const work = await this.runStage(context, "hydrateGitHubWork", "required", () => this.delegate.hydrateGitHubWork(context, metadata));
      await this.runStage(context, "hydrateIssueAndPullRequestRelations", "required", () =>
        this.delegate.hydrateIssueAndPullRequestRelations(context, work)
      );
      await this.runStage(context, "warmPullRequestDiffCache", "optional", () => this.delegate.warmPullRequestDiffCache(context, work));
      await this.runStage(context, "syncWorkflowRuns", "required", () => this.delegate.syncWorkflowRuns(context));
      await this.runStage(context, "pruneClosedIssueCache", "optional", () => this.delegate.pruneClosedIssueCache(context));
      await this.runStage(context, "rebuildRepoSearch", "required", () => this.delegate.rebuildRepoSearch(context));
      await this.runStage(context, "deriveRepoAttention", "required", () => this.delegate.deriveRepoAttention(context));
      await this.runStage(context, "recordBranchIntegrityAfterSync", "optional", () =>
        this.delegate.recordBranchIntegrityAfterSync(context)
      );
      await this.runStage(context, "recordSuccessfulRepoSync", "required", () => this.delegate.recordSuccessfulRepoSync(context));
    } catch (error) {
      await this.delegate.recordFailedRepoSync(context, error);
    }

    return this.delegate.latestSyncJob(context.job.id);
  }

  private async runStage<T>(context: RepoSyncContext, stage: string, policy: RepoSyncStagePolicy, task: () => Promise<T> | T): Promise<T> {
    try {
      return await task();
    } catch (error) {
      if (policy === "optional") {
        await this.delegate.recordOptionalStageFailure?.(context, stage, error);
        return undefined as T;
      }
      throw error;
    }
  }
}
