import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { AppView } from "../state/navigation-store";
import { rendererFreshnessKeys } from "../app/query-freshness";
import { isRepoScopedView } from "../sync-active-context";
import { writeStoredAuthState } from "./auth-storage";

const PUSH_INVALIDATION_DEBOUNCE_MS = 80;

export function useRendererEvents({
  queryClient,
  setSelectedRepoId,
  setView,
  view
}: {
  queryClient: QueryClient;
  setSelectedRepoId: (repoId: string | null) => void;
  setView: (view: AppView) => void;
  view: AppView;
}): void {
  useEffect(() => {
    let timer: number | null = null;
    const pending = new Set<string>();
    const enqueue = (...keys: string[]) => {
      for (const key of keys) pending.add(key);
      if (timer != null) return;
      timer = window.setTimeout(() => {
        const keysToInvalidate = [...pending];
        pending.clear();
        timer = null;
        for (const key of keysToInvalidate) {
          void queryClient.invalidateQueries({ queryKey: JSON.parse(key) as unknown[] });
        }
      }, PUSH_INVALIDATION_DEBOUNCE_MS);
    };
    const encoded = (keys: unknown[][]) => keys.map((key) => JSON.stringify(key));
    const refreshActiveProfileData = async () => {
      queryClient.setQueryData(["repos"], []);
      setSelectedRepoId(null);
      queryClient.removeQueries({ queryKey: ["availableRepos"] });
      queryClient.removeQueries({ queryKey: ["repoCodeSummary"] });
      queryClient.removeQueries({ queryKey: ["repoWorkspaces"] });
      queryClient.removeQueries({ queryKey: ["prs"] });
      queryClient.removeQueries({ queryKey: ["prDiff"] });
      queryClient.removeQueries({ queryKey: ["issues"] });
      queryClient.removeQueries({ queryKey: ["actionChecks"] });
      queryClient.removeQueries({ queryKey: ["workflowRuns"] });
      queryClient.removeQueries({ queryKey: ["localChanges"] });
      queryClient.removeQueries({ queryKey: ["repoIdentity"] });
      queryClient.removeQueries({ queryKey: ["myWorkAttention"] });
      queryClient.removeQueries({ queryKey: ["notifications"] });
      queryClient.removeQueries({ queryKey: ["notificationsSummary"] });

      const [nextAuth, nextProfiles, nextRepos] = await Promise.all([
        window.fallback.auth.getAuthState(),
        window.fallback.auth.listProfiles(),
        window.fallback.repos.listWatched()
      ]);
      queryClient.setQueryData(["auth"], nextAuth);
      queryClient.setQueryData(["accounts"], nextProfiles);
      queryClient.setQueryData(["profiles"], nextProfiles);
      queryClient.setQueryData(["repos"], nextRepos);
      writeStoredAuthState(nextAuth);
      if (nextRepos.length > 0) setSelectedRepoId(nextRepos[0].id);
      if (nextRepos.length === 0 && isRepoScopedView(view)) setView("home");
    };
    const unsubscribers = [
      window.fallback.events.onReposChanged((payload) =>
        enqueue(...encoded(rendererFreshnessKeys({ type: "repos", repoId: payload.repoId })))
      ),
      window.fallback.events.onProfileChanged(() => {
        void refreshActiveProfileData().catch(() => {
          enqueue(...encoded([["auth"], ["accounts"], ["profiles"], ["repos"]]));
        });
        enqueue(...encoded(rendererFreshnessKeys({ type: "profile" })));
      }),
      window.fallback.events.onSyncChanged((payload) =>
        enqueue(...encoded(rendererFreshnessKeys({ type: "sync", repoId: payload.repoId })))
      ),
      window.fallback.events.onLocalChangesChanged((payload) =>
        enqueue(...encoded(rendererFreshnessKeys({ type: "localChanges", repoId: payload.repoId })))
      ),
      window.fallback.events.onOperationsChanged((payload) =>
        enqueue(...encoded(rendererFreshnessKeys({ type: "operations", repoId: payload.repoId })))
      ),
      window.fallback.events.onNotificationsChanged(() => enqueue(...encoded(rendererFreshnessKeys({ type: "notifications" })))),
      window.fallback.events.onBranchIntegrityChanged((payload) =>
        enqueue(...encoded(rendererFreshnessKeys({ type: "branchIntegrity", repoId: payload.repoId })))
      ),
      window.fallback.events.onHealthChanged(() => enqueue(...encoded(rendererFreshnessKeys({ type: "health" }))))
    ];
    return () => {
      if (timer != null) window.clearTimeout(timer);
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [queryClient, setSelectedRepoId, setView, view]);
}
