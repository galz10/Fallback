import type { QueryClient } from "@tanstack/react-query";

export const rendererQueryKeys = {
  repos: () => ["repos"] as const,
  repoWorkspaces: (repoId: string) => ["repoWorkspaces", repoId] as const,
  repoIdentity: (repoId: string) => ["repoIdentity", repoId] as const,
  repoCodeSummary: (repoId: string) => ["repoCodeSummary", repoId] as const,
  repoFiles: (repoId: string) => ["repoFiles", repoId] as const,
  repoBranches: (repoId: string) => ["repoBranches", repoId] as const,
  commitGraph: (repoId: string) => ["commitGraph", repoId] as const,
  branchIntegritySummary: (repoId: string) => ["branchIntegritySummary", repoId] as const,
  branchIntegrityFindings: (repoId: string) => ["branchIntegrityFindings", repoId] as const,
  gitNetworkPreflight: (repoId: string) => ["gitNetworkPreflight", repoId] as const,
  conflictRisk: (repoId: string) => ["conflictRisk", repoId] as const,
  conflictState: (repoId: string) => ["conflictState", repoId] as const,
  operations: (repoId: string) => ["operations", repoId] as const,
  localChanges: (repoId: string) => ["localChanges", repoId] as const,
  localChangesSummary: () => ["localChangesSummary"] as const,
  localChangePatch: (repoId: string) => ["localChangePatch", repoId] as const
};

export type RendererFreshnessEvent =
  | { type: "repos"; repoId?: string | null }
  | { type: "profile" }
  | { type: "sync"; repoId?: string | null }
  | { type: "localChanges"; repoId?: string | null }
  | { type: "operations"; repoId?: string | null }
  | { type: "notifications" }
  | { type: "branchIntegrity"; repoId?: string | null }
  | { type: "health" };

export interface LocalChangesFreshnessOptions {
  refreshNetwork?: boolean;
  refreshRepoShape?: boolean;
}

export function rendererFreshnessKeys(event: RendererFreshnessEvent): unknown[][] {
  switch (event.type) {
    case "repos":
    case "sync":
      return repoWorkKeys(event.repoId);
    case "profile":
      return [["myPrs"], ["myIssues"], ["myWorkAttention"], ["notificationsSummary"], ["notifications"], ["search"], ["health"]];
    case "localChanges":
      return [
        ["localChangesSummary"],
        ["localChanges", event.repoId],
        ["localChangePatch", event.repoId],
        ["conflictState", event.repoId],
        ["repoCodeSummary", event.repoId],
        ["repoFiles", event.repoId],
        ["repoWorkspaces", event.repoId],
        ["commitGraph", event.repoId]
      ];
    case "operations":
      return [
        ["operations", event.repoId],
        ["paletteRecentOperations", event.repoId]
      ];
    case "notifications":
      return [["notificationsSummary"], ["notifications"], ["myWorkAttention"], ["myPrs"], ["myIssues"]];
    case "branchIntegrity":
      return [["branchIntegritySummaries"], ["branchIntegritySummary", event.repoId], ["branchIntegrityFindings", event.repoId]];
    case "health":
      return [["offlineStatus"], ["health"], ["healthHistory"]];
  }
}

export async function invalidateRendererFreshness(queryClient: QueryClient, event: RendererFreshnessEvent): Promise<void> {
  await Promise.all(rendererFreshnessKeys(event).map((queryKey) => invalidate(queryClient, queryKey)));
}

export async function invalidateLocalChangesFreshness(
  queryClient: QueryClient,
  repoId: string,
  options: LocalChangesFreshnessOptions = {}
): Promise<void> {
  const invalidations = [
    invalidate(queryClient, rendererQueryKeys.localChanges(repoId)),
    invalidate(queryClient, rendererQueryKeys.localChangesSummary()),
    invalidate(queryClient, rendererQueryKeys.localChangePatch(repoId)),
    invalidate(queryClient, rendererQueryKeys.conflictState(repoId))
  ];

  if (options.refreshNetwork) invalidations.push(...invalidateGitNetworkPreflightFreshness(queryClient, repoId));
  if (options.refreshRepoShape) invalidations.push(...repoShapeFreshnessInvalidations(queryClient, repoId));

  await Promise.all(invalidations);
}

export async function invalidateGitNetworkFreshness(queryClient: QueryClient, repoId: string): Promise<void> {
  await Promise.all([
    invalidate(queryClient, rendererQueryKeys.gitNetworkPreflight(repoId)),
    invalidate(queryClient, rendererQueryKeys.conflictRisk(repoId)),
    invalidate(queryClient, rendererQueryKeys.operations(repoId)),
    invalidate(queryClient, rendererQueryKeys.localChanges(repoId)),
    invalidate(queryClient, rendererQueryKeys.localChangesSummary()),
    invalidate(queryClient, rendererQueryKeys.repoCodeSummary(repoId)),
    invalidate(queryClient, rendererQueryKeys.repoBranches(repoId)),
    invalidate(queryClient, rendererQueryKeys.commitGraph(repoId)),
    invalidate(queryClient, rendererQueryKeys.branchIntegritySummary(repoId))
  ]);
}

export async function invalidateWorkspaceFreshness(queryClient: QueryClient, repoId: string): Promise<void> {
  await Promise.all([
    invalidate(queryClient, rendererQueryKeys.repoWorkspaces(repoId)),
    invalidate(queryClient, rendererQueryKeys.repos()),
    invalidate(queryClient, rendererQueryKeys.localChangesSummary()),
    invalidate(queryClient, rendererQueryKeys.localChanges(repoId)),
    ...repoShapeFreshnessInvalidations(queryClient, repoId),
    invalidate(queryClient, rendererQueryKeys.branchIntegrityFindings(repoId)),
    invalidate(queryClient, rendererQueryKeys.repoIdentity(repoId))
  ]);
}

export async function invalidateRepoWorkFreshness(queryClient: QueryClient, repoId?: string | null): Promise<void> {
  const invalidations = [
    invalidate(queryClient, rendererQueryKeys.repos()),
    invalidate(queryClient, rendererQueryKeys.localChangesSummary())
  ];
  if (repoId) {
    invalidations.push(
      invalidate(queryClient, rendererQueryKeys.repoWorkspaces(repoId)),
      invalidate(queryClient, rendererQueryKeys.localChanges(repoId)),
      ...repoShapeFreshnessInvalidations(queryClient, repoId),
      invalidate(queryClient, rendererQueryKeys.gitNetworkPreflight(repoId)),
      invalidate(queryClient, rendererQueryKeys.branchIntegrityFindings(repoId))
    );
  }
  await Promise.all(invalidations);
}

function repoShapeFreshnessInvalidations(queryClient: QueryClient, repoId: string): Array<Promise<unknown>> {
  return [
    invalidate(queryClient, rendererQueryKeys.repoCodeSummary(repoId)),
    invalidate(queryClient, rendererQueryKeys.repoFiles(repoId)),
    invalidate(queryClient, rendererQueryKeys.repoBranches(repoId)),
    invalidate(queryClient, rendererQueryKeys.commitGraph(repoId)),
    invalidate(queryClient, rendererQueryKeys.branchIntegritySummary(repoId))
  ];
}

function invalidateGitNetworkPreflightFreshness(queryClient: QueryClient, repoId: string): Array<Promise<unknown>> {
  return [
    invalidate(queryClient, rendererQueryKeys.gitNetworkPreflight(repoId)),
    invalidate(queryClient, rendererQueryKeys.conflictRisk(repoId))
  ];
}

function repoWorkKeys(repoId?: string | null): unknown[][] {
  return repoId
    ? [
        ["repos"],
        ["repoWorkspaces", repoId],
        ["repoCodeSummary", repoId],
        ["repoFiles", repoId],
        ["repoBranches", repoId],
        ["commitGraph", repoId],
        ["prs", repoId],
        ["prDiff", repoId],
        ["issues", repoId],
        ["actionChecks", repoId],
        ["workflowRuns", repoId]
      ]
    : [["repos"], ["availableRepos"], ["myPrs"], ["myIssues"], ["cache"], ["cacheDetailed"]];
}

function invalidate(queryClient: QueryClient, queryKey: readonly unknown[]): Promise<unknown> {
  return queryClient.invalidateQueries({ queryKey });
}
