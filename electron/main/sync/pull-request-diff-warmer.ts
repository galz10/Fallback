import type { RepoSyncContext, RepoSyncGitHubWork } from "./repo-sync-context.js";
import type { PullRequestDiffWarmRuntime } from "./repo-sync-stage-runtime.js";
import { prioritizePullRequests, pullRequestDiffWarmTarget } from "./repo-sync-utils.js";

const pullRequestDiffWarmLimit = numberFromEnv("FALLBACK_GITHUB_PR_DIFF_WARM_LIMIT", 500);
const pullRequestDiffBackfillLimit = numberFromEnv("FALLBACK_GITHUB_PR_DIFF_BACKFILL_LIMIT", 100);

export async function warmPullRequestDiffCache(
  runtime: PullRequestDiffWarmRuntime,
  context: RepoSyncContext,
  work: RepoSyncGitHubWork
): Promise<void> {
  const currentDiffTargets = prioritizePullRequests(
    work.allPullRequests.filter((pr) => pr.state === "open"),
    work.userPullRequestNumbers
  )
    .slice(0, pullRequestDiffWarmLimit)
    .map(pullRequestDiffWarmTarget);
  await runtime.warmPullRequestDiffs(context.repoId, context.apiPath, currentDiffTargets, context.job.id, "Caching PR diffs");

  const currentDiffTargetKeys = new Set(currentDiffTargets.map((target) => `${target.number}:${target.headSha ?? ""}`));
  const backfillTargets = runtime
    .listPullRequestsMissingDiffCache(context.repoId, pullRequestDiffBackfillLimit)
    .filter((target) => !currentDiffTargetKeys.has(`${target.number}:${target.headSha ?? ""}`));
  await runtime.warmPullRequestDiffs(context.repoId, context.apiPath, backfillTargets, context.job.id, "Backfilling cached PR diffs");
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
