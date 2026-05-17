import type { RepoSyncContext, RepoSyncGitHubWork, RepoSyncMetadata } from "./repo-sync-context.js";
import type { GitHubWorkHydrationRuntime } from "./repo-sync-stage-runtime.js";
import { persistGitHubWorkToCache } from "./github-work-cache-persistence.js";
import { uniqueIssuesByNumber, uniquePullRequestsByNumber, prioritizePullRequests } from "./repo-sync-utils.js";

const repoListSyncPages = numberFromEnv("FALLBACK_GITHUB_LIST_SYNC_PAGES", 5);
const missingPullRequestLookupLimit = numberFromEnv("FALLBACK_GITHUB_MISSING_PR_LOOKUP_LIMIT", 100);
const relationHydrationLimit = numberFromEnv("FALLBACK_GITHUB_RELATION_HYDRATION_LIMIT", 100);
const userPullRequestLookupLimit = numberFromEnv("FALLBACK_GITHUB_USER_PR_LOOKUP_LIMIT", 500);

export async function hydrateGitHubWork(
  runtime: GitHubWorkHydrationRuntime,
  context: RepoSyncContext,
  metadata: RepoSyncMetadata
): Promise<RepoSyncGitHubWork> {
  runtime.progress(context, "Fetching pull requests, issues, labels, and issue metadata");
  const [pullRequests, closedPullRequests, issues, closedIssues, labels, issueTypes, issueFields] = await Promise.all([
    runtime.paginatePullRequests(context.apiPath, "open", repoListSyncPages),
    runtime.paginatePullRequests(context.apiPath, "closed", 1),
    runtime.paginateIssues(context.apiPath, "open", metadata.since, repoListSyncPages),
    runtime.paginateIssues(context.apiPath, "closed", metadata.since, 1),
    runtime.paginateLabels(context.apiPath, 2),
    runtime.fetchIssueTypes(context.owner),
    runtime.fetchIssueFields(context.owner)
  ]);
  if (metadata.viewer) runtime.progress(context, "Finding your pull requests");
  const userPullRequestIssues = metadata.viewer ? await runtime.userPullRequestIssues(context.apiPath) : [];

  const allIssues = uniqueIssuesByNumber([...issues, ...closedIssues, ...userPullRequestIssues]);
  const knownPrNumbers = new Set([...pullRequests, ...closedPullRequests].map((pr) => pr.number));
  const userPullRequestNumbers = new Set(userPullRequestIssues.filter((issue) => issue.pull_request).map((issue) => issue.number));
  const missingUserPrIssues = userPullRequestIssues.filter((issue) => issue.pull_request && !knownPrNumbers.has(issue.number));
  const missingGeneralPrIssues = allIssues.filter(
    (issue) => issue.pull_request && !knownPrNumbers.has(issue.number) && !userPullRequestNumbers.has(issue.number)
  );
  const prDetailTargets = uniqueIssuesByNumber([
    ...missingUserPrIssues.slice(0, userPullRequestLookupLimit),
    ...missingGeneralPrIssues.slice(0, missingPullRequestLookupLimit)
  ]);
  if (prDetailTargets.length > 0) runtime.progress(context, `Fetching ${prDetailTargets.length} missing PR details`);
  const changedPrs = await Promise.all(prDetailTargets.map((issue) => runtime.fetchPullRequest(context.apiPath, issue.number)));
  const allPullRequests = uniquePullRequestsByNumber([...pullRequests, ...closedPullRequests, ...changedPrs]);

  const persisted = persistGitHubWorkToCache(runtime, { repoId: context.repoId, issues: allIssues, pullRequests: allPullRequests, labels });
  runtime.replaceIssueTypes(context.repoId, issueTypes);
  runtime.replaceIssueFieldOptions(context.repoId, issueFields);
  runtime.progress(context, `Caching ${persisted.changedPullRequestCount} changed PRs and ${persisted.changedIssueCount} changed issues`);

  await runtime.backfillIssueList(context.repoId, context.apiPath, context.job.id);
  return {
    allIssues,
    allPullRequests,
    labels,
    userPullRequestNumbers,
    pullRequestRefreshByNumber: persisted.pullRequestRefreshByNumber,
    issueRefreshByNumber: persisted.issueRefreshByNumber
  };
}

export async function hydrateIssueAndPullRequestRelations(
  runtime: GitHubWorkHydrationRuntime,
  context: RepoSyncContext,
  work: RepoSyncGitHubWork
): Promise<void> {
  const issueTargets = work.allIssues
    .filter((item) => !item.pull_request && work.issueRefreshByNumber.get(item.number))
    .slice(0, relationHydrationLimit);
  for (const [index, issue] of issueTargets.entries()) {
    runtime.progress(context, `Caching issue comments ${index + 1}/${issueTargets.length}`);
    await runtime.syncIssueComments(context.repoId, context.apiPath, issue, 1);
  }
  const prTargets = prioritizePullRequests(
    work.allPullRequests.filter((pr) => work.pullRequestRefreshByNumber.get(pr.number)),
    work.userPullRequestNumbers
  ).slice(0, relationHydrationLimit);
  for (const [index, pr] of prTargets.entries()) {
    runtime.progress(context, `Caching PR reviews and checks ${index + 1}/${prTargets.length}`);
    await runtime.syncPullRequestRelations(context.repoId, context.apiPath, pr, 1);
  }
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
