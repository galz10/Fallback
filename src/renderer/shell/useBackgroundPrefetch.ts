import { useEffect, useMemo } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { AuthState } from "../../shared/domain/auth";
import type { WatchedRepo } from "../../shared/domain/watched-repo";
import type { AppView } from "../state/navigation-store";

const REPO_WORK_STALE_TIME_MS = 5 * 60_000;
const REPO_WORK_GC_TIME_MS = 30 * 60_000;
const BACKGROUND_PREFETCH_DELAY_MS = 12_000;
export const BACKGROUND_PREFETCH_CONCURRENCY = 2;
export const BACKGROUND_PREFETCH_REPO_LIMIT = 6;
const BACKGROUND_PREFETCH_BURST_LOG_THRESHOLD = 12;

type BackgroundPrefetchTask = {
  label: string;
  run: () => Promise<unknown>;
};

export function useBackgroundPrefetch({
  auth,
  authAccountKey,
  queryClient,
  repos,
  selectedRepoId,
  view,
  visible
}: {
  auth: AuthState;
  authAccountKey: string;
  queryClient: QueryClient;
  repos: WatchedRepo[];
  selectedRepoId: string | null;
  view: AppView;
  visible: boolean;
}): void {
  const repoWorkWarmKey = useMemo(() => {
    const orderedRepoIds = new Set<string>();
    if (selectedRepoId) orderedRepoIds.add(selectedRepoId);
    for (const repo of repos) {
      if (repo.openPullRequests > 0 || repo.openIssues > 0) orderedRepoIds.add(repo.id);
    }
    return [...orderedRepoIds].join("|");
  }, [repos, selectedRepoId]);

  useEffect(() => {
    if (view === "Settings" || !visible || !repoWorkWarmKey) return;
    let cancelled = false;
    const repoIds = repoWorkWarmKey.split("|").filter(Boolean).slice(0, BACKGROUND_PREFETCH_REPO_LIMIT);

    const warmRepoWorkCache = async () => {
      const tasks = repoIds.flatMap((repoId) => [
        repoWorkPrefetchTask(queryClient, `prs:${repoId}`, ["prs", repoId], () => window.fallback.prs.list(repoId)),
        repoWorkPrefetchTask(queryClient, `issues:${repoId}`, ["issues", repoId], () => window.fallback.issues.list(repoId)),
        repoWorkPrefetchTask(queryClient, `checks:${repoId}`, ["actionChecks", repoId], () => window.fallback.actions.listChecks(repoId)),
        repoWorkPrefetchTask(queryClient, `runs:${repoId}`, ["workflowRuns", repoId], () =>
          window.fallback.actions.listWorkflowRuns(repoId)
        )
      ]);
      await runBackgroundPrefetchTasks("repo-work", tasks, () => cancelled);
    };

    const timeout = window.setTimeout(() => {
      void warmRepoWorkCache();
    }, BACKGROUND_PREFETCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [queryClient, repoWorkWarmKey, view, visible]);

  useEffect(() => {
    if (view === "Settings" || !visible || auth.status !== "connected") return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void runBackgroundPrefetchTasks(
        "my-work",
        [
          repoWorkPrefetchTask(queryClient, `my-prs:${authAccountKey}`, ["myPrs", authAccountKey], window.fallback.prs.listMine),
          repoWorkPrefetchTask(queryClient, `my-issues:${authAccountKey}`, ["myIssues", authAccountKey], window.fallback.issues.listMine)
        ],
        () => cancelled
      );
    }, BACKGROUND_PREFETCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [queryClient, auth.status, authAccountKey, view, visible]);
}

function repoWorkPrefetchTask<T>(
  queryClient: QueryClient,
  label: string,
  queryKey: unknown[],
  queryFn: () => Promise<T>
): BackgroundPrefetchTask {
  return {
    label,
    run: () =>
      queryClient.prefetchQuery({
        queryKey,
        queryFn,
        staleTime: REPO_WORK_STALE_TIME_MS,
        gcTime: REPO_WORK_GC_TIME_MS
      })
  };
}

export async function runBackgroundPrefetchTasks(
  label: string,
  tasks: BackgroundPrefetchTask[],
  isCancelled: () => boolean
): Promise<void> {
  const startedAt = performance.now();
  let completed = 0;
  for (let index = 0; index < tasks.length; index += BACKGROUND_PREFETCH_CONCURRENCY) {
    if (isCancelled()) break;
    const batch = tasks.slice(index, index + BACKGROUND_PREFETCH_CONCURRENCY);
    await Promise.all(
      batch.map((task) =>
        task
          .run()
          .then(() => {
            completed += 1;
          })
          .catch(() => undefined)
      )
    );
  }
  const durationMs = performance.now() - startedAt;
  if (completed >= BACKGROUND_PREFETCH_BURST_LOG_THRESHOLD || durationMs >= 250) {
    console.info(`[perf] background prefetch ${label}: tasks=${completed}/${tasks.length} total=${Math.round(durationMs)}ms`);
  }
}
