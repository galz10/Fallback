import type { SyncActiveContext } from "../shared/domain/sync.js";
import type { AppView } from "./state/navigation-store.js";

const repoScopedViews: AppView[] = ["Code", "Local Changes", "Issues", "Pull requests", "Actions", "Branch Integrity"];

export interface RendererSyncSelection {
  view: AppView;
  selectedRepoId: string | null;
  selectedPrNumber: number | null;
  selectedIssueNumber: number | null;
  selectedMyPr: { repoId: string; number: number } | null;
  selectedMyIssue: { repoId: string; number: number } | null;
  visible: boolean;
  online: boolean;
}

export function isRepoScopedView(view: AppView): boolean {
  return repoScopedViews.includes(view);
}

export function buildSyncActiveContext(selection: RendererSyncSelection): SyncActiveContext {
  const repoId =
    selection.selectedMyPr?.repoId ??
    selection.selectedMyIssue?.repoId ??
    (isRepoScopedView(selection.view) ? selection.selectedRepoId : null);

  return {
    repoId,
    view: selection.view,
    prNumber: selection.selectedMyPr?.number ?? selection.selectedPrNumber,
    issueNumber: selection.selectedMyIssue?.number ?? selection.selectedIssueNumber,
    visible: selection.visible,
    online: selection.online
  };
}
