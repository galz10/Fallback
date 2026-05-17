import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FallbackWindowRoute } from "../../shared/domain/window-context";
import type { WatchedRepo } from "../../shared/domain/watched-repo";
import type { CredentialDiagnosticReport } from "../../shared/domain/repo-identity";
import type { SearchResult } from "../../shared/domain/github-work";
import { useNavigationStore } from "../state/navigation-store";
import { useRepoSelectionStore } from "../state/repo-selection-store";
import { isRepoScopedView } from "../sync-active-context";
import type { CommitOpenTarget, RepoFileOpenTarget } from "../features/repo-code/RepoCodeView";
import { localChangesSidebarLabel } from "../lib/format";
import { authScopedQueryKey } from "./auth-storage";
import { useActiveSyncContext } from "./useActiveSyncContext";
import { useAuthProfileRefresh } from "./useAuthProfileRefresh";
import { useBackgroundPrefetch } from "./useBackgroundPrefetch";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useRendererEvents } from "./useRendererEvents";
import { useStartupHydration } from "./useStartupHydration";
import { useWindowContext, type WindowEntitySetters } from "./useWindowContext";
import { connectivityRecoveryProbeIntervalMs, isRecoverableGitHubConnectivityState } from "./connectivity-recovery";
import { ShellChrome } from "./ShellChrome";
import { ViewRouter } from "./ViewRouter";
import { ShellComponentsContext, type AppShellComponents } from "./shell-components";
import { SignedOutView } from "./SignedOutView";

export function AppShell({ components, onRendererReady }: { components: AppShellComponents; onRendererReady: () => void }) {
  return (
    <ShellComponentsContext.Provider value={components}>
      <AppContent onRendererReady={onRendererReady} />
    </ShellComponentsContext.Provider>
  );
}

function isActiveSyncStatus(status: WatchedRepo["syncStatus"]): boolean {
  return status === "queued" || status === "syncing";
}

function AppContent({ onRendererReady }: { onRendererReady: () => void }) {
  const appQueryClient = useQueryClient();
  const view = useNavigationStore((s) => s.view);
  const setView = useNavigationStore((s) => s.setView);
  const selectedRepoId = useRepoSelectionStore((s) => s.selectedRepoId);
  const setSelectedRepoId = useRepoSelectionStore((s) => s.setSelectedRepoId);
  const [error, setError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteReturnFocusRef = useRef<HTMLElement | null>(null);
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);
  const [selectedMyPr, setSelectedMyPr] = useState<{ repoId: string; number: number } | null>(null);
  const [selectedMyIssue, setSelectedMyIssue] = useState<{ repoId: string; number: number } | null>(null);
  const [selectedIssueNumber, setSelectedIssueNumber] = useState<number | null>(null);
  const [pullRequestQueriesByRepo, setPullRequestQueriesByRepo] = useState<Record<string, string>>({});
  const [issueQueriesByRepo, setIssueQueriesByRepo] = useState<Record<string, string>>({});
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const [repoFileOpenTarget, setRepoFileOpenTarget] = useState<RepoFileOpenTarget | null>(null);
  const [commitOpenTarget, setCommitOpenTarget] = useState<CommitOpenTarget | null>(null);
  const [activeTab, setActiveTab] = useState("Files");
  const [windowContextNotice, setWindowContextNotice] = useState<string | null>(null);
  const [localChangesCommitPrefill, setLocalChangesCommitPrefill] = useState<{ repoId: string; summary: string; token: string } | null>(
    null
  );
  const online = useNetworkOnline();
  const visible = useDocumentVisible();
  const previousOnlineRef = useRef(online);
  const recoveryProbeInFlightRef = useRef(false);
  const windowNavigationStackRef = useRef<FallbackWindowRoute[]>([]);
  const entitySetters = useMemo<WindowEntitySetters>(
    () => ({
      setSelectedPrNumber,
      setSelectedIssueNumber,
      setSelectedMyPr,
      setSelectedMyIssue,
      setSelectedOperationId,
      setActiveTab,
      setRepoFileOpenTarget,
      setCommitOpenTarget
    }),
    []
  );
  useRendererEvents({ queryClient: appQueryClient, setSelectedRepoId, setView, view });
  const { auth, richChromeEnabled, startupHydrationEnabled } = useStartupHydration({
    entitySetters,
    navigationStackRef: windowNavigationStackRef,
    onRendererReady,
    selectedRepoId,
    setSelectedRepoId,
    setView,
    setWindowContextNotice,
    queryClient: appQueryClient,
    view,
    visible
  });
  useAuthProfileRefresh(appQueryClient);
  const authAccountKey = authScopedQueryKey(auth);
  const { data: repos = [], isPending: reposPending } = useQuery({
    queryKey: ["repos"],
    queryFn: window.fallback.repos.listWatched,
    enabled: view !== "Settings" && visible && startupHydrationEnabled,
    initialData: () => appQueryClient.getQueryData<WatchedRepo[]>(["repos"]) ?? [],
    refetchInterval: view === "Settings" || !visible || !online ? false : 120_000
  });
  const { data: offline } = useQuery({
    queryKey: ["offlineStatus"],
    queryFn: window.fallback.health.offlineStatus,
    enabled: view !== "Settings",
    refetchInterval: visible ? 60_000 : false
  });
  const runConnectivityRecoveryProbe = useCallback(() => {
    if (recoveryProbeInFlightRef.current) return;
    recoveryProbeInFlightRef.current = true;
    void window.fallback.health
      .runProbe()
      .catch(() => undefined)
      .finally(() => {
        recoveryProbeInFlightRef.current = false;
        void appQueryClient.invalidateQueries({ queryKey: ["offlineStatus"] });
        void appQueryClient.invalidateQueries({ queryKey: ["health"] });
        void appQueryClient.invalidateQueries({ queryKey: ["healthHistory"] });
        void window.fallback.offlineActions.flush();
        void appQueryClient.invalidateQueries({ queryKey: ["offlineActions"] });
      });
  }, [appQueryClient]);
  useEffect(() => {
    const wasOnline = previousOnlineRef.current;
    previousOnlineRef.current = online;
    if (!online || !visible || (wasOnline && !isRecoverableGitHubConnectivityState(offline?.state))) return;
    runConnectivityRecoveryProbe();
  }, [offline?.state, online, runConnectivityRecoveryProbe, visible]);
  useEffect(() => {
    if (!online || !visible || !isRecoverableGitHubConnectivityState(offline?.state)) return;
    const id = window.setInterval(runConnectivityRecoveryProbe, connectivityRecoveryProbeIntervalMs);
    return () => window.clearInterval(id);
  }, [offline?.state, online, runConnectivityRecoveryProbe, visible]);
  useBackgroundPrefetch({ auth, authAccountKey, queryClient: appQueryClient, repos, selectedRepoId, view, visible });
  useActiveSyncContext({
    auth,
    online,
    selectedIssueNumber,
    selectedMyIssue,
    selectedMyPr,
    selectedPrNumber,
    selectedRepoId,
    view,
    visible
  });

  useEffect(() => {
    if (reposPending) return;

    const hasSelectedRepo = Boolean(selectedRepoId && repos.some((repo) => repo.id === selectedRepoId));
    if (repos.length === 0) {
      if (selectedRepoId) setSelectedRepoId(null);
      if (isRepoScopedView(view)) setView("home");
      return;
    }

    if (!hasSelectedRepo) setSelectedRepoId(repos[0].id);
  }, [repos, reposPending, selectedRepoId, setSelectedRepoId, setView, view]);

  const openPalette = useCallback(() => {
    paletteReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    window.setTimeout(() => paletteReturnFocusRef.current?.focus(), 0);
  }, []);
  const commandShortcutLabel = useGlobalShortcuts({ closePalette, openPalette, paletteOpen, setView });

  const selectedRepo = repos.find((r) => r.id === selectedRepoId) ?? null;
  const pullRequestQuery = selectedRepoId ? (pullRequestQueriesByRepo[selectedRepoId] ?? "") : "";
  const issueQuery = selectedRepoId ? (issueQueriesByRepo[selectedRepoId] ?? "") : "";
  const setPullRequestQuery = (query: string) => {
    if (!selectedRepoId) return;
    setPullRequestQueriesByRepo((queries) => ({ ...queries, [selectedRepoId]: query }));
  };
  const setIssueQuery = (query: string) => {
    if (!selectedRepoId) return;
    setIssueQueriesByRepo((queries) => ({ ...queries, [selectedRepoId]: query }));
  };
  const isInRepo = Boolean(selectedRepo && isRepoScopedView(view));
  const syncingRepos = repos.filter((repo) => isActiveSyncStatus(repo.syncStatus));
  const { data: codeSummary } = useQuery({
    queryKey: ["repoCodeSummary", selectedRepoId],
    queryFn: () => window.fallback.repos.codeSummary(selectedRepoId!),
    enabled: Boolean(selectedRepoId && isInRepo),
    staleTime: 60_000
  });
  const {
    data: localChanges,
    error: localChangesError,
    isFetching: localChangesFetching
  } = useQuery({
    queryKey: ["localChanges", selectedRepoId],
    queryFn: () => window.fallback.repos.localChangesOverview(selectedRepoId!),
    enabled: Boolean(selectedRepoId && selectedRepo?.localPath && isInRepo && startupHydrationEnabled),
    refetchInterval: isInRepo ? 30_000 : false,
    staleTime: 1000
  });
  const { data: activeRepoWorkspaces = [] } = useQuery({
    queryKey: ["repoWorkspaces", selectedRepoId],
    queryFn: () => window.fallback.repos.listWorkspaces(selectedRepoId!),
    enabled: Boolean(selectedRepoId && selectedRepo?.localPath && isInRepo && startupHydrationEnabled),
    staleTime: 15_000
  });
  const activeWorkspace = useMemo(() => activeRepoWorkspaces.find((workspace) => workspace.isActive) ?? null, [activeRepoWorkspaces]);
  const { data: operationContextRecords = [] } = useQuery({
    queryKey: ["windowOperationContext", selectedRepoId, selectedOperationId],
    queryFn: () => window.fallback.operations.listRecent(selectedRepoId ?? undefined),
    enabled: Boolean(selectedOperationId),
    staleTime: 5000
  });
  const selectedOperationContext = useMemo(
    () => operationContextRecords.find((operation) => operation.id === selectedOperationId) ?? null,
    [operationContextRecords, selectedOperationId]
  );
  const { openCurrentWindowContext } = useWindowContext({
    activeTab,
    activeWorkspace,
    auth,
    commitOpenTarget,
    navigationStackRef: windowNavigationStackRef,
    repoFileOpenTarget,
    selectedIssueNumber,
    selectedMyIssue,
    selectedMyPr,
    selectedOperationId,
    selectedPrNumber,
    selectedRepo,
    view
  });

  useEffect(() => {
    if (activeTab === "Local Changes") setActiveTab("Files");
  }, [activeTab]);

  useEffect(() => {
    if (view === "Local Changes" && localChanges && !localChangesFetching && !localChanges.isDirty && localChanges.stashes.length === 0) {
      setView("Code");
    }
  }, [localChanges, localChangesFetching, setView, view]);

  const repoAuthError = selectedRepo?.syncStatus === "auth_error" ? selectedRepo.syncError : null;
  const showLocalChangesItem = Boolean(localChanges && (localChanges.isDirty || localChanges.stashes.length > 0));
  const localChangesLabel = localChanges ? localChangesSidebarLabel(localChanges) : undefined;
  const [bannerDiagnosticsReport, setBannerDiagnosticsReport] = useState<CredentialDiagnosticReport | null>(null);

  const bannerDiagnostics = useMutation({
    mutationFn: async () => {
      if (!selectedRepo) throw new Error("Select a repository before running diagnostics.");
      return window.fallback.repos.checkCredentials(selectedRepo.id);
    },
    onSuccess: async (report) => {
      setBannerDiagnosticsReport(report);
      await appQueryClient.invalidateQueries({ queryKey: ["repoIdentity", selectedRepo?.id] });
    },
    onError: (diagnosticError) => setError(errorMessage(diagnosticError))
  });
  const resetScopedTargets = () => {
    setSelectedPrNumber(null);
    setSelectedIssueNumber(null);
    setSelectedMyPr(null);
    setSelectedMyIssue(null);
    setSelectedOperationId(null);
    setRepoFileOpenTarget(null);
    setCommitOpenTarget(null);
  };
  const openRepoCode = (repoId: string, tab: string = "Files") => {
    resetScopedTargets();
    setSelectedRepoId(repoId);
    setActiveTab(tab);
    setView("Code");
  };
  const openFileTarget = (repoId: string, path: string) => {
    resetScopedTargets();
    setSelectedRepoId(repoId);
    setActiveTab("Files");
    setRepoFileOpenTarget({ repoId, path, token: `${repoId}:${path}:${Date.now()}` });
    setView("Code");
  };
  const openCommitTarget = (repoId: string, sha: string) => {
    resetScopedTargets();
    setSelectedRepoId(repoId);
    setActiveTab("Commits");
    setCommitOpenTarget({ repoId, sha, token: `${repoId}:${sha}:${Date.now()}` });
    setView("Code");
  };
  const openResult = (result: SearchResult) => {
    setSelectedRepoId(result.repoId);
    setRepoFileOpenTarget(null);
    setCommitOpenTarget(null);
    setSelectedOperationId(null);
    setSelectedMyPr(null);
    setSelectedMyIssue(null);
    if (result.entityType === "repo") {
      setSelectedPrNumber(null);
      setSelectedIssueNumber(null);
      setActiveTab("Files");
      setView("Code");
    } else if (result.entityType === "issue") {
      setSelectedPrNumber(null);
      setSelectedIssueNumber(result.entityNumber);
      setView("Issues");
    } else {
      setSelectedIssueNumber(null);
      setSelectedPrNumber(result.entityNumber);
      setView("Pull requests");
    }
    setPaletteOpen(false);
  };
  const routedContent = (
    <ViewRouter
      activeTab={activeTab}
      auth={auth}
      codeSummary={codeSummary}
      commitOpenTarget={commitOpenTarget}
      issueQuery={issueQuery}
      localChanges={localChanges}
      localChangesCommitPrefill={localChangesCommitPrefill}
      localChangesError={localChangesError}
      localChangesFetching={localChangesFetching}
      onOpenRepoCode={openRepoCode}
      pullRequestQuery={pullRequestQuery}
      repoFileOpenTarget={repoFileOpenTarget}
      repos={repos}
      reposPending={reposPending}
      selectedIssueNumber={selectedIssueNumber}
      selectedMyIssue={selectedMyIssue}
      selectedMyPr={selectedMyPr}
      selectedPrNumber={selectedPrNumber}
      selectedRepo={selectedRepo}
      selectedRepoId={selectedRepoId}
      setActiveTab={setActiveTab}
      setIssueQuery={setIssueQuery}
      setLocalChangesCommitPrefill={setLocalChangesCommitPrefill}
      setPullRequestQuery={setPullRequestQuery}
      setSelectedIssueNumber={setSelectedIssueNumber}
      setSelectedMyIssue={setSelectedMyIssue}
      setSelectedMyPr={setSelectedMyPr}
      setSelectedPrNumber={setSelectedPrNumber}
      setView={setView}
      view={view}
    />
  );

  if (auth.status === "disconnected") {
    return <SignedOutView />;
  }

  return (
    <ShellChrome
      auth={auth}
      bannerDiagnosticsReport={bannerDiagnosticsReport}
      clearBannerDiagnosticsReport={() => setBannerDiagnosticsReport(null)}
      clearError={() => setError(null)}
      clearOperationContext={() => setSelectedOperationId(null)}
      clearWindowContextNotice={() => setWindowContextNotice(null)}
      closePalette={closePalette}
      codeSummary={codeSummary}
      commandShortcutLabel={commandShortcutLabel}
      error={error}
      localChangesLabel={localChangesLabel}
      offline={offline}
      online={online}
      openCurrentWindowContext={openCurrentWindowContext}
      openPalette={openPalette}
      openRepoCode={openRepoCode}
      paletteOpen={paletteOpen}
      repoAuthError={repoAuthError}
      repos={repos}
      richChromeEnabled={richChromeEnabled}
      runAuthDiagnostics={() => {
        if (selectedRepo) bannerDiagnostics.mutate();
        else setView("Status");
      }}
      selectedOperationContext={selectedOperationContext}
      selectedRepo={selectedRepo}
      setSelectedMyIssue={setSelectedMyIssue}
      setSelectedMyPr={setSelectedMyPr}
      setSelectedPrNumber={setSelectedPrNumber}
      setView={setView}
      showLocalChangesItem={showLocalChangesItem}
      syncingRepos={syncingRepos}
      view={view}
      windowContextNotice={windowContextNotice}
      onOpenCommit={openCommitTarget}
      onOpenFile={openFileTarget}
      onOpenResult={openResult}
    >
      {routedContent}
    </ShellChrome>
  );
}

function useNetworkOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
