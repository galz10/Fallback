import type { GitHubRepo, GitHubUser } from "../github-client.js";
import { errorMessage } from "../error-classification.js";
import { nowIso } from "../path-utils.js";
import type { RepoSyncContext, RepoSyncMetadata } from "./repo-sync-context.js";
import type { RepoSyncPipelineDelegate } from "./repo-sync-pipeline.js";
import type {
  RepoPostSyncRuntime,
  RepoSyncJobRecordingRuntime,
  RepoSyncMetadataRuntime,
  RepoSyncStageRuntime
} from "./repo-sync-stage-runtime.js";
import { hydrateGitHubWork, hydrateIssueAndPullRequestRelations } from "./github-work-hydrator.js";
import { warmPullRequestDiffCache } from "./pull-request-diff-warmer.js";
import { warmRepoCodeCache } from "./repo-code-cache-warmer.js";
import { hydrateWorkflowRuns } from "./workflow-run-hydrator.js";

export function createRepoSyncPipelineDelegate(runtime: RepoSyncStageRuntime): RepoSyncPipelineDelegate {
  return {
    latestSyncJob: (jobId) => runtime.latestSyncJob(jobId),
    prepareRepoSync: (context) => prepareRepoSync(runtime, context),
    refreshLocalRemoteState: (context) => refreshLocalRemoteState(runtime, context),
    syncRepoMetadata: (context) => syncRepoMetadata(runtime, context),
    warmCodeCache: (context, metadata) => warmRepoCodeCache(runtime, context, metadata),
    hydrateGitHubWork: (context, metadata) => hydrateGitHubWork(runtime, context, metadata),
    hydrateIssueAndPullRequestRelations: (context, work) => hydrateIssueAndPullRequestRelations(runtime, context, work),
    warmPullRequestDiffCache: (context, work) => warmPullRequestDiffCache(runtime, context, work),
    syncWorkflowRuns: (context) => hydrateWorkflowRuns(runtime, context),
    pruneClosedIssueCache: (context) => pruneClosedIssueCache(runtime, context),
    rebuildRepoSearch: (context) => rebuildRepoSearch(runtime, context),
    deriveRepoAttention: (context) => deriveRepoAttention(runtime, context),
    recordBranchIntegrityAfterSync: (context) => runtime.recordBranchIntegrityAfterSync(context),
    recordSuccessfulRepoSync: (context) => recordSuccessfulRepoSync(runtime, context),
    recordFailedRepoSync: (context, error) => recordFailedRepoSync(runtime, context, error),
    recordOptionalStageFailure: (context, stage, error) => runtime.recordOptionalStageFailure(context, stage, error)
  };
}

function prepareRepoSync(runtime: RepoSyncJobRecordingRuntime, context: RepoSyncContext): void {
  runtime.progress(context, "Preparing sync");
  runtime.updateSyncJob(context.job.id, { status: "running", startedAt: context.startedAt, ...runtime.rateLimitPatch() });
  runtime.setRepoSyncState(context.repoId, "syncing", null);
  runtime.setRepoAccountSyncState(context.repoId, context.job.accountId, "syncing", null);
}

async function refreshLocalRemoteState(runtime: RepoSyncMetadataRuntime, context: RepoSyncContext): Promise<void> {
  if (!context.knownRepo?.localPath) return;
  runtime.progress(context, `Fetching origin/${context.knownRepo.defaultBranch ?? "main"}`);
  await runtime.refreshRepoRemoteState(context.knownRepo.localPath, context.knownRepo.defaultBranch ?? "main");
}

async function syncRepoMetadata(runtime: RepoSyncMetadataRuntime, context: RepoSyncContext): Promise<RepoSyncMetadata> {
  runtime.progress(context, "Fetching repository metadata");
  const repo = await runtime.fetchRepo(context.apiPath);
  const shouldClone = runtime.shouldCloneRepo(context.knownRepo?.watchMode);
  const localPath = runtime.ensureRepoFolder(context.owner, context.name, shouldClone ? "cloned" : "metadata-only");
  runtime.upsertRepo(repo, localPath, "syncing", null, true, shouldClone);
  runtime.associateCurrentAccount(repo);
  await ensureRepoStorage(runtime, context, repo, shouldClone);
  const viewer = await runtime.optionalGithub<GitHubUser | null>(() => runtime.fetchViewer(), null);
  return { repo, localPath, viewer, since: context.knownRepo?.lastSuccessfulSyncAt ?? undefined };
}

async function ensureRepoStorage(
  runtime: RepoSyncMetadataRuntime,
  context: RepoSyncContext,
  repo: GitHubRepo,
  shouldClone: boolean
): Promise<void> {
  if (!shouldClone) return;
  await runtime.cloneOrFetchRepo(
    context.repoId,
    context.owner,
    context.name,
    repo.clone_url,
    repo.default_branch ?? context.knownRepo?.defaultBranch
  );
}

function rebuildRepoSearch(runtime: RepoPostSyncRuntime, context: RepoSyncContext): void {
  runtime.progress(context, "Updating search index");
  runtime.rebuildSearchIndex(context.repoId);
}

function pruneClosedIssueCache(runtime: RepoPostSyncRuntime, context: RepoSyncContext): void {
  runtime.progress(context, "Pruning old closed issues");
  runtime.pruneClosedIssueCache(context.repoId);
}

function deriveRepoAttention(runtime: RepoPostSyncRuntime, context: RepoSyncContext): void {
  runtime.progress(context, "Updating attention inbox");
  runtime.deriveAttentionForRepo(context.repoId);
}

function recordSuccessfulRepoSync(runtime: RepoSyncJobRecordingRuntime, context: RepoSyncContext): void {
  const syncedAt = nowIso();
  runtime.setRepoSyncState(context.repoId, "fresh", null, syncedAt);
  runtime.setRepoAccountSyncState(context.repoId, context.job.accountId, "fresh", null, syncedAt);
  runtime.updateRepoMarker(context.owner, context.name, { lastSyncedAt: syncedAt });
  runtime.recordOperationalHealthProbe(context.repoId, context.fullName, syncedAt, Date.now() - Date.parse(context.startedAt));
  runtime.updateSyncJob(context.job.id, {
    status: "success",
    progressMessage: "Sync complete",
    completedAt: nowIso(),
    ...runtime.rateLimitPatch()
  });
  runtime.notifySyncChanged(context.repoId);
}

function recordFailedRepoSync(runtime: RepoSyncJobRecordingRuntime, context: RepoSyncContext, error: unknown): void {
  const message = errorMessage(error);
  runtime.updateAccountAuthFailure(error);
  runtime.recordFailedHealthProbe(context.repoId, context.fullName, context.job.accountId, error, nowIso());
  runtime.failSyncJob(context.job.id, error, message);
}
