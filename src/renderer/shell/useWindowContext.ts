import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { AuthState } from "../../shared/domain/auth";
import type { RepoWorkspace, WatchedRepo } from "../../shared/domain/watched-repo";
import type { FallbackWindowRoute } from "../../shared/domain/window-context";
import type { CommitOpenTarget, RepoFileOpenTarget } from "../features/repo-code/RepoCodeView";
import type { AppView } from "../state/navigation-store";
import { isRepoScopedView } from "../sync-active-context";

export interface WindowEntitySetters {
  setSelectedPrNumber: (value: number | null) => void;
  setSelectedIssueNumber: (value: number | null) => void;
  setSelectedMyPr: (value: { repoId: string; number: number } | null) => void;
  setSelectedMyIssue: (value: { repoId: string; number: number } | null) => void;
  setSelectedOperationId: (value: string | null) => void;
  setActiveTab: (value: string) => void;
  setRepoFileOpenTarget: (value: RepoFileOpenTarget | null) => void;
  setCommitOpenTarget: (value: CommitOpenTarget | null) => void;
}

export function useWindowContext({
  activeTab,
  activeWorkspace,
  auth,
  commitOpenTarget,
  repoFileOpenTarget,
  selectedIssueNumber,
  selectedMyIssue,
  selectedMyPr,
  selectedOperationId,
  selectedPrNumber,
  selectedRepo,
  view,
  navigationStackRef
}: {
  activeTab: string;
  activeWorkspace: RepoWorkspace | null;
  auth: AuthState;
  commitOpenTarget: CommitOpenTarget | null;
  repoFileOpenTarget: RepoFileOpenTarget | null;
  selectedIssueNumber: number | null;
  selectedMyIssue: { repoId: string; number: number } | null;
  selectedMyPr: { repoId: string; number: number } | null;
  selectedOperationId: string | null;
  selectedPrNumber: number | null;
  selectedRepo: WatchedRepo | null;
  view: AppView;
  navigationStackRef: MutableRefObject<FallbackWindowRoute[]>;
}) {
  const lastReportedRouteRef = useRef("");

  const route = currentWindowRoute({
    view,
    selectedRepo,
    activeWorkspace,
    activeTab,
    selectedPrNumber,
    selectedIssueNumber,
    selectedMyPr,
    selectedMyIssue,
    selectedOperationId,
    repoFileOpenTarget,
    commitOpenTarget
  });

  useEffect(() => {
    const routeKey = windowRouteKey(route);
    if (routeKey !== lastReportedRouteRef.current) {
      lastReportedRouteRef.current = routeKey;
      const stack = navigationStackRef.current;
      navigationStackRef.current = [...stack.filter((item) => windowRouteKey(item) !== routeKey), route].slice(-30);
    }
    const timeout = window.setTimeout(() => {
      void window.fallback.window
        .updateContext({
          repoId: route.repoId,
          workspaceId: route.workspaceId,
          view: route.view,
          selectedEntityId: route.selectedEntityId,
          navigationStack: navigationStackRef.current,
          accountId: auth.status === "disconnected" ? null : (auth.accountId ?? null)
        })
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [auth, navigationStackRef, route]);

  const openCurrentWindowContext = useCallback(() => {
    void window.fallback.window.openContext({
      repoId: route.repoId,
      workspaceId: route.workspaceId,
      view: route.view,
      selectedEntityId: route.selectedEntityId,
      navigationStack: navigationStackRef.current,
      accountId: auth.status === "disconnected" ? null : (auth.accountId ?? null)
    });
  }, [auth, navigationStackRef, route]);

  return {
    navigationStackRef,
    openCurrentWindowContext
  };
}

export function currentWindowRoute({
  view,
  selectedRepo,
  activeWorkspace,
  activeTab,
  selectedPrNumber,
  selectedIssueNumber,
  selectedMyPr,
  selectedMyIssue,
  selectedOperationId,
  repoFileOpenTarget,
  commitOpenTarget
}: {
  view: AppView;
  selectedRepo: WatchedRepo | null;
  activeWorkspace: RepoWorkspace | null;
  activeTab: string;
  selectedPrNumber: number | null;
  selectedIssueNumber: number | null;
  selectedMyPr: { repoId: string; number: number } | null;
  selectedMyIssue: { repoId: string; number: number } | null;
  selectedOperationId: string | null;
  repoFileOpenTarget: RepoFileOpenTarget | null;
  commitOpenTarget: CommitOpenTarget | null;
}): FallbackWindowRoute {
  const repoId = selectedMyPr?.repoId ?? selectedMyIssue?.repoId ?? (isRepoScopedView(view) ? (selectedRepo?.id ?? null) : null);
  const fileTarget = view === "Code" && repoFileOpenTarget?.repoId === selectedRepo?.id ? repoFileOpenTarget : null;
  const commitTarget = view === "Code" && commitOpenTarget?.repoId === selectedRepo?.id ? commitOpenTarget : null;
  const entity = selectedMyPr
    ? `my-pr:${selectedMyPr.repoId}:${selectedMyPr.number}`
    : selectedMyIssue
      ? `my-issue:${selectedMyIssue.repoId}:${selectedMyIssue.number}`
      : selectedOperationId
        ? `operation:${selectedOperationId}`
        : selectedPrNumber
          ? `pr:${selectedPrNumber}`
          : selectedIssueNumber
            ? `issue:${selectedIssueNumber}`
            : fileTarget
              ? `file:${fileTarget.path}`
              : commitTarget
                ? `commit:${commitTarget.sha}`
                : view === "Code"
                  ? `code:${activeTab}`
                  : null;
  return {
    repoId,
    workspaceId: repoId === selectedRepo?.id ? (activeWorkspace?.id ?? null) : null,
    view,
    selectedEntityId: entity,
    label: selectedRepo ? `${selectedRepo.fullName} / ${view}` : view,
    at: new Date().toISOString()
  };
}

export function windowRouteKey(route: Pick<FallbackWindowRoute, "repoId" | "workspaceId" | "view" | "selectedEntityId">): string {
  return [route.repoId ?? "", route.workspaceId ?? "", route.view, route.selectedEntityId ?? ""].join("\x1f");
}

export function applyRestoredEntity(selectedEntityId: string | null, repoId: string | null, setters: WindowEntitySetters): void {
  setters.setSelectedPrNumber(null);
  setters.setSelectedIssueNumber(null);
  setters.setSelectedMyPr(null);
  setters.setSelectedMyIssue(null);
  setters.setSelectedOperationId(null);
  setters.setRepoFileOpenTarget(null);
  setters.setCommitOpenTarget(null);
  if (!selectedEntityId) return;
  const parts = selectedEntityId.split(":");
  if (parts[0] === "pr") setters.setSelectedPrNumber(numberOrNull(parts[1]));
  if (parts[0] === "issue") setters.setSelectedIssueNumber(numberOrNull(parts[1]));
  if (parts[0] === "operation" && parts[1]) setters.setSelectedOperationId(parts.slice(1).join(":"));
  if (parts[0] === "code" && parts[1]) setters.setActiveTab(parts.slice(1).join(":"));
  if (parts[0] === "file" && repoId && parts[1]) {
    const filePath = parts.slice(1).join(":");
    setters.setActiveTab("Files");
    setters.setRepoFileOpenTarget({ repoId, path: filePath, token: `${repoId}:${filePath}:${Date.now()}` });
  }
  if (parts[0] === "commit" && repoId && parts[1]) {
    setters.setActiveTab("Commits");
    setters.setCommitOpenTarget({ repoId, sha: parts.slice(1).join(":"), token: `${repoId}:${parts.slice(1).join(":")}:${Date.now()}` });
  }
  if (parts[0] === "my-pr") {
    const number = numberOrNull(parts[2]);
    if (parts[1] && number) setters.setSelectedMyPr({ repoId: parts[1], number });
  }
  if (parts[0] === "my-issue") {
    const number = numberOrNull(parts[2]);
    if (parts[1] && number) setters.setSelectedMyIssue({ repoId: parts[1], number });
  }
  if (!repoId && parts[0] === "pr") setters.setSelectedPrNumber(null);
}

function numberOrNull(value: string | undefined): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
