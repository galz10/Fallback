import assert from "node:assert/strict";
import { RepoSyncPipeline, type RepoSyncPipelineDelegate } from "../electron/main/sync/repo-sync-pipeline.js";
import type { RepoSyncContext, RepoSyncGitHubWork, RepoSyncMetadata } from "../electron/main/sync/repo-sync-context.js";
import { createRepoSyncPipelineDelegate } from "../electron/main/sync/repo-sync-stages.js";
import type { RepoSyncStageRuntime } from "../electron/main/sync/repo-sync-stage-runtime.js";
import type { SyncJob } from "../src/shared/domain/sync.js";

const context: RepoSyncContext = {
  job: { id: "job-1", accountId: null } as SyncJob,
  repoId: "octo-repo",
  fullName: "octo/repo",
  owner: "octo",
  name: "repo",
  apiPath: "/repos/octo/repo",
  knownRepo: null,
  startedAt: "2026-01-01T00:00:00.000Z"
};

const metadata = {
  repo: { full_name: "octo/repo" },
  localPath: "/tmp/repo",
  viewer: null,
  since: undefined
} as RepoSyncMetadata;

const githubWork: RepoSyncGitHubWork = {
  allIssues: [],
  allPullRequests: [],
  labels: [],
  userPullRequestNumbers: new Set(),
  pullRequestRefreshByNumber: new Map(),
  issueRefreshByNumber: new Map()
};

function createDelegate(
  options: {
    failOptionalStage?: string;
    failRequiredStage?: string;
  } = {}
): RepoSyncPipelineDelegate & { stages: string[]; optionalFailures: string[]; failed: boolean; succeeded: boolean } {
  const stages: string[] = [];
  const optionalFailures: string[] = [];
  let failed = false;
  let succeeded = false;
  const run = async <T>(stage: string, value: T): Promise<T> => {
    stages.push(stage);
    if (options.failOptionalStage === stage || options.failRequiredStage === stage) throw new Error(`${stage} failed`);
    return value;
  };
  return {
    stages,
    optionalFailures,
    get failed() {
      return failed;
    },
    get succeeded() {
      return succeeded;
    },
    latestSyncJob: () => ({ id: "job-1", status: succeeded ? "success" : failed ? "failed" : "running" }) as SyncJob,
    prepareRepoSync: () => run("prepareRepoSync", undefined),
    refreshLocalRemoteState: () => run("refreshLocalRemoteState", undefined),
    syncRepoMetadata: () => run("syncRepoMetadata", metadata),
    warmCodeCache: () => run("warmCodeCache", undefined),
    hydrateGitHubWork: () => run("hydrateGitHubWork", githubWork),
    hydrateIssueAndPullRequestRelations: () => run("hydrateIssueAndPullRequestRelations", undefined),
    warmPullRequestDiffCache: () => run("warmPullRequestDiffCache", undefined),
    syncWorkflowRuns: () => run("syncWorkflowRuns", undefined),
    pruneClosedIssueCache: () => run("pruneClosedIssueCache", undefined),
    rebuildRepoSearch: () => run("rebuildRepoSearch", undefined),
    deriveRepoAttention: () => run("deriveRepoAttention", undefined),
    recordBranchIntegrityAfterSync: () => run("recordBranchIntegrityAfterSync", undefined),
    recordSuccessfulRepoSync: async () => {
      await run("recordSuccessfulRepoSync", undefined);
      succeeded = true;
    },
    recordFailedRepoSync: async () => {
      stages.push("recordFailedRepoSync");
      failed = true;
    },
    recordOptionalStageFailure: (_context, stage) => {
      optionalFailures.push(stage);
    }
  };
}

const optionalDelegate = createDelegate({ failOptionalStage: "warmPullRequestDiffCache" });
const optionalResult = await new RepoSyncPipeline(optionalDelegate).run(context);
assert.equal(optionalResult.status, "success");
assert.equal(optionalDelegate.failed, false);
assert.equal(optionalDelegate.succeeded, true);
assert.deepEqual(optionalDelegate.optionalFailures, ["warmPullRequestDiffCache"]);
assert.ok(optionalDelegate.stages.indexOf("pruneClosedIssueCache") < optionalDelegate.stages.indexOf("rebuildRepoSearch"));
assert.ok(optionalDelegate.stages.includes("recordSuccessfulRepoSync"));

const requiredDelegate = createDelegate({ failRequiredStage: "hydrateGitHubWork" });
const requiredResult = await new RepoSyncPipeline(requiredDelegate).run(context);
assert.equal(requiredResult.status, "failed");
assert.equal(requiredDelegate.failed, true);
assert.equal(requiredDelegate.succeeded, false);
assert.deepEqual(requiredDelegate.optionalFailures, []);
assert.deepEqual(requiredDelegate.stages.slice(0, requiredDelegate.stages.indexOf("recordFailedRepoSync") + 1), [
  "prepareRepoSync",
  "refreshLocalRemoteState",
  "syncRepoMetadata",
  "warmCodeCache",
  "hydrateGitHubWork",
  "recordFailedRepoSync"
]);

const stateTransitions: Array<{ repoId: string; status: string; error: string | null; successfulSyncAt?: string }> = [];
const accountStateTransitions: Array<{
  repoId: string;
  accountId: string | null;
  status: string;
  error: string | null;
  successfulSyncAt?: string;
}> = [];
const jobPatches: Array<Partial<SyncJob>> = [];
const markerUpdates: Array<{ owner: string; name: string; marker: { lastSyncedAt: string } }> = [];
const healthProbes: Array<{ repoId: string; fullName: string; at: string; durationMs: number }> = [];
const failedHealthProbes: Array<{ repoId: string; fullName: string; accountId: string | null; at: string }> = [];
const notifications: Array<string | null> = [];
const optionalStageDiagnostics: Array<{ stage: string; message: string }> = [];
const authFailures: unknown[] = [];
const failedJobs: Array<{ jobId: string; message: string | undefined }> = [];

const stageDelegate = createRepoSyncPipelineDelegate({
  latestSyncJob: () => ({ id: "job-1", status: "running" }) as SyncJob,
  progress: () => undefined,
  rateLimitPatch: () => ({ githubRateLimitRemaining: 42, githubRateLimitResetAt: "2026-01-01T01:00:00.000Z" }),
  setRepoSyncState: (repoId, status, error, successfulSyncAt) => stateTransitions.push({ repoId, status, error, successfulSyncAt }),
  setRepoAccountSyncState: (repoId, accountId, status, error, successfulSyncAt) =>
    accountStateTransitions.push({ repoId, accountId, status, error, successfulSyncAt }),
  updateSyncJob: (_jobId, patch) => {
    jobPatches.push(patch);
  },
  updateRepoMarker: (owner, name, marker) => {
    markerUpdates.push({ owner, name, marker });
  },
  recordOperationalHealthProbe: (repoId, fullName, at, durationMs) => {
    healthProbes.push({ repoId, fullName, at, durationMs });
  },
  recordFailedHealthProbe: (repoId, fullName, accountId, _error, at) => {
    failedHealthProbes.push({ repoId, fullName, accountId, at });
  },
  updateAccountAuthFailure: (error) => {
    authFailures.push(error);
  },
  failSyncJob: (jobId, _error, message) => {
    failedJobs.push({ jobId, message });
  },
  notifySyncChanged: (repoId) => {
    notifications.push(repoId);
  },
  recordOptionalStageFailure: (_context, stage, error) => {
    optionalStageDiagnostics.push({ stage, message: error instanceof Error ? error.message : String(error) });
  },
  pruneClosedIssueCache: () => undefined
} as Partial<RepoSyncStageRuntime> as RepoSyncStageRuntime);

stageDelegate.prepareRepoSync?.(context);
assert.deepEqual(stateTransitions[0], { repoId: "octo-repo", status: "syncing", error: null, successfulSyncAt: undefined });
assert.deepEqual(accountStateTransitions[0], {
  repoId: "octo-repo",
  accountId: null,
  status: "syncing",
  error: null,
  successfulSyncAt: undefined
});
assert.equal(jobPatches[0]?.status, "running");

await stageDelegate.recordSuccessfulRepoSync?.(context);
assert.equal(stateTransitions.at(-1)?.status, "fresh");
assert.equal(accountStateTransitions.at(-1)?.status, "fresh");
assert.equal(typeof stateTransitions.at(-1)?.successfulSyncAt, "string");
assert.equal(markerUpdates[0]?.owner, "octo");
assert.equal(markerUpdates[0]?.name, "repo");
assert.equal(typeof markerUpdates[0]?.marker.lastSyncedAt, "string");
assert.equal(healthProbes[0]?.repoId, "octo-repo");
assert.equal(jobPatches.at(-1)?.status, "success");
assert.equal(jobPatches.at(-1)?.progressMessage, "Sync complete");
assert.equal(notifications.at(-1), "octo-repo");

const failure = new Error("boom");
await stageDelegate.recordFailedRepoSync?.(context, failure);
assert.equal(authFailures[0], failure);
assert.equal(failedHealthProbes[0]?.repoId, "octo-repo");
assert.deepEqual(failedJobs[0], { jobId: "job-1", message: "boom" });

await stageDelegate.recordOptionalStageFailure?.(context, "warmPullRequestDiffCache", failure);
assert.deepEqual(optionalStageDiagnostics[0], { stage: "warmPullRequestDiffCache", message: "boom" });

console.log("Repo sync pipeline tests ok");
