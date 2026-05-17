import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";

export function useAuthProfileRefresh(queryClient: QueryClient): void {
  useEffect(() => {
    return window.fallback.auth.onBrowserOAuthResult((result) => {
      if (result.status !== "success") return;
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["auth"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["availableRepos"] }),
        queryClient.invalidateQueries({ queryKey: ["myPrs"] }),
        queryClient.invalidateQueries({ queryKey: ["myIssues"] })
      ]);
    });
  }, [queryClient]);
}
