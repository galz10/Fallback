import { useEffect } from "react";
import type { AuthState } from "../../shared/domain/auth";
import type { AppView } from "../state/navigation-store";
import { buildSyncActiveContext } from "../sync-active-context";

export function useActiveSyncContext({
  auth,
  online,
  selectedIssueNumber,
  selectedMyIssue,
  selectedMyPr,
  selectedPrNumber,
  selectedRepoId,
  view,
  visible
}: {
  auth: AuthState;
  online: boolean;
  selectedIssueNumber: number | null;
  selectedMyIssue: { repoId: string; number: number } | null;
  selectedMyPr: { repoId: string; number: number } | null;
  selectedPrNumber: number | null;
  selectedRepoId: string | null;
  view: AppView;
  visible: boolean;
}): void {
  useEffect(() => {
    if (auth.status !== "connected") return;
    void window.fallback.sync
      .setActiveContext(
        buildSyncActiveContext({
          selectedRepoId,
          selectedMyPr,
          selectedMyIssue,
          selectedPrNumber,
          selectedIssueNumber,
          view,
          visible,
          online
        })
      )
      .catch(() => undefined);
  }, [auth.status, online, selectedIssueNumber, selectedMyIssue, selectedMyPr, selectedPrNumber, selectedRepoId, view, visible]);
}
