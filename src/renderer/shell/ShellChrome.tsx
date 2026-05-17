import React, { Suspense, useEffect, useState } from "react";
import type { AttentionItem } from "../../shared/attention";
import { hasAuthAccountDetails } from "../../shared/auth-recovery";
import type { AuthState } from "../../shared/domain/auth";
import type { SearchResult } from "../../shared/domain/github-work";
import type { OfflineStatus } from "../../shared/domain/health";
import type { OfflineAction, OfflineActionPayload, OfflineActionQueueSummary } from "../../shared/domain/offline-action";
import {
  offlineActionCanEdit,
  offlineActionCanRetry,
  offlineActionIsActive,
  offlineActionLabel,
  offlineActionPreview,
  offlineActionTitle
} from "../../shared/domain/offline-action";
import type { OperationRecord } from "../../shared/domain/operation";
import type { RepoCodeSummary } from "../../shared/domain/repo-code";
import type { CredentialDiagnosticReport } from "../../shared/domain/repo-identity";
import type { WatchedRepo } from "../../shared/domain/watched-repo";
import { AuthRecoveryBanner } from "../components/AuthRecoveryBanner";
import { ShellIcon } from "../components/ShellIcon";
import { DotmCircular3 } from "../components/ui/dotm-circular-3";
import { compactCount, formatDate, formatRelative, shortHash, shortSha } from "../lib/format";
import type { AppView } from "../state/navigation-store";
import { useShellComponents } from "./shell-components";
import { WindowLogoControls } from "./WindowLogoControls";

const offlineBannerVisibleMs = 30_000;

type GitHubChromeStatus = {
  tone: "orange" | "red";
  icon: "activity" | "airplane";
  label: string;
  message: string;
} | null;

export function ShellChrome({
  auth,
  bannerDiagnosticsReport,
  children,
  clearBannerDiagnosticsReport,
  clearError,
  clearOperationContext,
  clearWindowContextNotice,
  closePalette,
  codeSummary,
  commandShortcutLabel,
  error,
  localChangesLabel,
  offline,
  online,
  openCurrentWindowContext,
  openPalette,
  openRepoCode,
  paletteOpen,
  repoAuthError,
  repos,
  richChromeEnabled,
  runAuthDiagnostics,
  selectedOperationContext,
  selectedRepo,
  setSelectedMyIssue,
  setSelectedMyPr,
  setSelectedPrNumber,
  setView,
  showLocalChangesItem,
  syncingRepos,
  view,
  windowContextNotice,
  onOpenCommit,
  onOpenFile,
  onOpenResult
}: {
  auth: AuthState;
  bannerDiagnosticsReport: CredentialDiagnosticReport | null;
  children: React.ReactNode;
  clearBannerDiagnosticsReport: () => void;
  clearError: () => void;
  clearOperationContext: () => void;
  clearWindowContextNotice: () => void;
  closePalette: () => void;
  codeSummary?: RepoCodeSummary;
  commandShortcutLabel: string;
  error: string | null;
  localChangesLabel?: string;
  offline?: OfflineStatus;
  online: boolean;
  openCurrentWindowContext: () => void;
  openPalette: () => void;
  openRepoCode: (repoId: string, tab?: string) => void;
  paletteOpen: boolean;
  repoAuthError: string | null;
  repos: WatchedRepo[];
  richChromeEnabled: boolean;
  runAuthDiagnostics: () => void;
  selectedOperationContext: OperationRecord | null;
  selectedRepo: WatchedRepo | null;
  setSelectedMyIssue: (target: { repoId: string; number: number } | null) => void;
  setSelectedMyPr: (target: { repoId: string; number: number } | null) => void;
  setSelectedPrNumber: (value: number | null) => void;
  setView: (view: AppView) => void;
  showLocalChangesItem: boolean;
  syncingRepos: WatchedRepo[];
  view: AppView;
  windowContextNotice: string | null;
  onOpenCommit: (repoId: string, sha: string) => void;
  onOpenFile: (repoId: string, path: string) => void;
  onOpenResult: (result: SearchResult) => void;
}) {
  const { CommandPalette, CredentialDiagnosticsDialog, ProfileMenu, Toaster } = useShellComponents();
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);
  const offlineMessage = offlineBanner(online, offline, repos);
  const githubStatus = githubStatusForChrome(online, offline, repos);
  const isInRepo = Boolean(selectedRepo && isRepoScopedView(view));

  useEffect(() => {
    if (!offlineMessage) {
      setShowOfflineBanner(false);
      return;
    }

    setShowOfflineBanner(true);
    const id = window.setTimeout(() => setShowOfflineBanner(false), offlineBannerVisibleMs);
    return () => window.clearTimeout(id);
  }, [offlineMessage]);

  const openAttentionItem = (item: AttentionItem) => {
    if (item.entityType === "pull_request" && item.number) {
      setSelectedMyPr({ repoId: item.repoId, number: item.number });
      setView("My Work");
    } else if (item.entityType === "issue" && item.number) {
      setSelectedMyIssue({ repoId: item.repoId, number: item.number });
      setView("My Work");
    } else if (item.htmlUrl) {
      void window.fallback.shell.openExternal(item.htmlUrl);
    }
  };

  const openQueuedAction = (action: OfflineAction) => {
    if (action.entityType === "pull_request") {
      setSelectedMyPr({ repoId: action.repoId, number: action.entityNumber });
      setView("My Work");
      return;
    }
    setSelectedMyIssue({ repoId: action.repoId, number: action.entityNumber });
    setView("My Work");
  };

  return (
    <div className="app-shell flex h-screen font-sans">
      <div className="app-sidebar relative flex shrink-0 flex-col">
        <div className="app-drag-region sidebar-search-row flex h-[68px] items-center gap-2.5 border-b border-border px-4">
          <WindowLogoControls onOpenNewWindow={openCurrentWindowContext} />
          <button
            onClick={openPalette}
            className="app-no-drag sidebar-search-button relative flex min-w-0 flex-1 items-center py-1.5 pl-8 pr-14 text-left text-[13px] transition-colors"
            aria-label="Open command palette"
          >
            <ShellIcon name="search" className="absolute left-2.5 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-neutral-500" />
            <span className="sidebar-search-label">Find...</span>
            <div className="sidebar-search-shortcut absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 text-[10px] font-mono text-muted-foreground">
              {commandShortcutLabel}
            </div>
          </button>
        </div>

        <div className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3">
          <NavItem
            icon={<ShellIcon name="repo" className="h-[18px] w-[18px]" />}
            label="Watched repositories"
            shortcut="H"
            active={view === "home"}
            onClick={() => setView("home")}
          />
          <NavItem
            icon={<ShellIcon name="issue" className="h-[18px] w-[18px]" />}
            label="My Work"
            active={view === "My Work"}
            onClick={() => {
              setView("My Work");
              setSelectedMyPr(null);
              setSelectedMyIssue(null);
            }}
          />
          {isInRepo && selectedRepo && (
            <>
              <div className="mx-3 my-3 h-px bg-border" />
              {showLocalChangesItem && (
                <NavItem
                  icon={<ShellIcon name="rotate" className="h-[18px] w-[18px]" />}
                  label="Local changes"
                  count={localChangesLabel}
                  active={view === "Local Changes"}
                  onClick={() => setView("Local Changes")}
                />
              )}
              <NavItem
                icon={<ShellIcon name="code" className="h-[18px] w-[18px]" />}
                label="Code"
                active={view === "Code"}
                onClick={() => openRepoCode(selectedRepo.id)}
              />
              <NavItem
                icon={<ShellIcon name="issue" className="h-[18px] w-[18px]" />}
                label="Issues"
                count={compactCount(selectedRepo.openIssues)}
                active={view === "Issues"}
                onClick={() => setView("Issues")}
              />
              <NavItem
                icon={<ShellIcon name="pr" className="h-[18px] w-[18px]" />}
                label="Pull requests"
                count={compactCount(selectedRepo.openPullRequests)}
                active={view === "Pull requests"}
                onClick={() => {
                  setView("Pull requests");
                  setSelectedPrNumber(null);
                }}
              />
              <NavItem
                icon={<ShellIcon name="workflow" className="h-[18px] w-[18px]" />}
                label="Actions"
                isChevron
                active={view === "Actions"}
                onClick={() => setView("Actions")}
              />
              <NavItem
                icon={<ShellIcon name="shield-alert" className="h-[18px] w-[18px]" />}
                label="Branch Watch"
                active={view === "Branch Integrity"}
                onClick={() => setView("Branch Integrity")}
              />
            </>
          )}
          <div className="my-4" />
          <NavItem
            icon={<ShellIcon name="pulse" className="h-[18px] w-[18px]" />}
            label="GitHub Status"
            active={view === "Status"}
            onClick={() => setView("Status")}
          />
        </div>

        <div className="relative mt-auto px-3 py-4">
          {richChromeEnabled ? (
            <Suspense fallback={<ProfileMenuShell auth={auth} />}>
              <ProfileMenu auth={auth} onOpenSettings={() => setView("Settings")} />
            </Suspense>
          ) : (
            <ProfileMenuShell auth={auth} />
          )}
        </div>
      </div>

      <div className="app-main relative flex flex-1 flex-col overflow-hidden">
        <TopContextBar
          view={view}
          repo={selectedRepo}
          repos={repos}
          codeSummary={codeSummary}
          syncingRepos={syncingRepos}
          auth={auth}
          richChromeEnabled={richChromeEnabled}
          githubStatus={githubStatus}
          onOpenMyWork={() => setView("My Work")}
          onOpenAttentionItem={openAttentionItem}
          onOpenQueuedAction={openQueuedAction}
        />

        {Boolean(error) && (
          <div className="mx-6 mb-2 flex items-center justify-between rounded-lg border border-red-700/30 bg-red-200/35 p-3 text-sm text-red-900">
            <span>{error}</span>
            <button onClick={clearError} className="rounded border border-red-700/30 px-2 py-1 text-sm text-red-900 hover:text-red-1000">
              Dismiss
            </button>
          </div>
        )}
        {offlineMessage && showOfflineBanner && (
          <div className="mx-6 mb-2 rounded-lg border border-border bg-background-100 p-3 text-sm text-muted-foreground shadow-border-small">
            {offlineMessage}
          </div>
        )}
        {windowContextNotice && (
          <div className="mx-6 mb-2 flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-background-100 px-3 py-2 text-sm text-muted-foreground shadow-border-small">
            <span>{windowContextNotice}</span>
            <button
              type="button"
              onClick={clearWindowContextNotice}
              className="rounded-md px-2 py-1 text-xs text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200"
            >
              Dismiss
            </button>
          </div>
        )}
        <AuthRecoveryBanner auth={auth} repoAuthError={repoAuthError} actionLabel="Diagnose" onAction={runAuthDiagnostics} />
        {selectedOperationContext && <WindowOperationContext operation={selectedOperationContext} onClose={clearOperationContext} />}

        <Suspense fallback={<RouteFallback view={view} />}>{children}</Suspense>
      </div>

      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette onClose={closePalette} onOpenResult={onOpenResult} onOpenFile={onOpenFile} onOpenCommit={onOpenCommit} />
        </Suspense>
      )}
      {bannerDiagnosticsReport && (
        <Suspense fallback={null}>
          <CredentialDiagnosticsDialog report={bannerDiagnosticsReport} onClose={clearBannerDiagnosticsReport} />
        </Suspense>
      )}
      {richChromeEnabled && (
        <Suspense fallback={null}>
          <Toaster richColors position="bottom-right" />
        </Suspense>
      )}
    </div>
  );
}

function WindowOperationContext({ operation, onClose }: { operation: OperationRecord; onClose: () => void }) {
  return (
    <div className="mx-6 mb-2 flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-[#070707] px-3 py-2 text-xs text-neutral-400">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-neutral-200">{operation.commandSummary ?? operation.kind}</div>
        <div className="mt-1 flex min-w-0 flex-wrap gap-2 font-mono text-[11px] text-neutral-600">
          <span>{operation.status}</span>
          <span>{operation.repoFullName ?? operation.repoId ?? "global"}</span>
          {operation.workspaceBranch && <span>{operation.workspaceBranch}</span>}
          {operation.workspacePath && <span className="max-w-[420px] truncate">{operation.workspacePath}</span>}
        </div>
        {(operation.resultSummary || operation.errorMessage) && (
          <div className="mt-1 truncate text-[12px] text-neutral-500">{operation.resultSummary ?? operation.errorMessage}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded-md px-2 py-1 text-[11px] text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200"
      >
        Clear
      </button>
    </div>
  );
}

function RouteFallback({ view }: { view: AppView }) {
  if (view === "home") {
    return (
      <div className="flex-1 overflow-hidden bg-black px-6 py-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <div className="h-9 w-48 rounded-md bg-neutral-900" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="h-24 rounded-lg border border-neutral-900 bg-neutral-950" />
            <div className="h-24 rounded-lg border border-neutral-900 bg-neutral-950" />
            <div className="h-24 rounded-lg border border-neutral-900 bg-neutral-950" />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="h-24 rounded-lg border border-neutral-900 bg-neutral-950" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  return <div className="flex-1 bg-black" />;
}

function ProfileMenuShell({ auth }: { auth: AuthState }) {
  const label = hasAuthAccountDetails(auth) ? (auth.login ?? "GitHub") : "Disconnected";
  const initials = hasAuthAccountDetails(auth)
    ? (auth.login ?? "GH")
        .split(/[-_\s]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("")
    : "GH";

  return (
    <div className="flex w-full items-center gap-3 px-2 py-2 text-left">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-background-100 text-[12px] font-semibold text-muted-foreground shadow-border-small">
        {initials}
      </div>
      <div className="sidebar-profile-copy flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium text-foreground">{label}</span>
        {auth.status !== "connected" && <span className="truncate text-[11px] text-muted-foreground">Connect GitHub</span>}
      </div>
    </div>
  );
}

function NavItem({
  icon,
  label,
  count,
  shortcut,
  active,
  onClick,
  isChevron
}: {
  icon: React.ReactNode;
  label: string;
  count?: string | number;
  shortcut?: string;
  active?: boolean;
  onClick?: () => void;
  isChevron?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`sidebar-nav-item flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left text-[13px] transition-colors ${
        active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
      }`}
    >
      <div className="sidebar-nav-inner flex items-center space-x-3">
        <span className={active ? "text-accent-foreground" : "text-muted-foreground"}>{icon}</span>
        <span className="sidebar-label">{label}</span>
      </div>
      {count !== undefined && (
        <span className={`sidebar-count text-[12px] font-sans ${active ? "text-accent-foreground" : "text-muted-foreground"}`}>
          {count}
        </span>
      )}
      {shortcut && count === undefined && !isChevron && (
        <span className="sidebar-shortcut rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {shortcut}
        </span>
      )}
      {isChevron && (
        <span className="text-muted-foreground">
          <ShellIcon name="chevron-right" className="h-[14px] w-[14px] -rotate-90" />
        </span>
      )}
    </button>
  );
}

function TopContextBar({
  view,
  repo,
  repos,
  codeSummary,
  syncingRepos,
  auth,
  richChromeEnabled,
  onOpenMyWork,
  onOpenAttentionItem,
  onOpenQueuedAction,
  githubStatus
}: {
  view: AppView;
  repo: WatchedRepo | null;
  repos: WatchedRepo[];
  codeSummary?: RepoCodeSummary;
  syncingRepos: WatchedRepo[];
  auth: AuthState;
  richChromeEnabled: boolean;
  onOpenMyWork: () => void;
  onOpenAttentionItem: (item: AttentionItem) => void;
  onOpenQueuedAction: (action: OfflineAction) => void;
  githubStatus: GitHubChromeStatus;
}) {
  const { AccountIdentityButton, BranchSelector, WorkspaceSelector } = useShellComponents();
  const [activeDetails, setActiveDetails] = useState<"sync" | "github" | "queue" | null>(null);

  if (view === "Code" && repo) {
    const latestCommit = codeSummary?.latestCommit;
    return (
      <div className="app-drag-region app-top-context flex h-[56px] max-w-full shrink-0 items-center justify-between px-6">
        <div className="app-no-drag app-top-context-primary flex items-center space-x-2.5 overflow-visible whitespace-nowrap pr-4 text-sm">
          <div className="flex items-center space-x-2.5 text-neutral-400">
            <div className="h-1.5 w-1.5 rounded-full bg-green-700" />
            <span>Production</span>
          </div>
          <div className="text-neutral-600">/</div>
          <Suspense fallback={<span className="text-neutral-500">{repo.defaultBranch ?? "branch"}</span>}>
            <BranchSelector repo={repo} codeSummary={codeSummary} />
          </Suspense>
          <div className="text-neutral-600">/</div>
          <Suspense fallback={<span className="text-neutral-500">workspace</span>}>
            <WorkspaceSelector repo={repo} />
          </Suspense>
          <div className="text-neutral-600">/</div>
          <span className="font-mono text-neutral-400">
            {latestCommit ? shortSha(latestCommit.sha) : repo.lastSuccessfulSyncAt ? shortHash(repo.id) : "unsynced"}
          </span>
        </div>

        <div className="app-no-drag app-top-context-secondary flex shrink-0 items-center gap-5 text-[13px] text-neutral-500">
          <div className="flex items-center gap-2">
            <SyncProgressIndicator
              activeRepos={syncingRepos}
              compact
              open={activeDetails === "sync"}
              onOpenChange={(open) => setActiveDetails(open ? "sync" : null)}
            />
            <GitHubStatusGlow
              status={githubStatus}
              open={activeDetails === "github"}
              onOpenChange={(open) => setActiveDetails(open ? "github" : null)}
            />
            <GitHubSendQueueChrome
              open={activeDetails === "queue"}
              onOpenChange={(open) => setActiveDetails(open ? "queue" : null)}
              onOpenAction={onOpenQueuedAction}
            />
            {richChromeEnabled && <NotificationsChrome auth={auth} onOpenMyWork={onOpenMyWork} onOpenItem={onOpenAttentionItem} />}
          </div>
          {richChromeEnabled && (
            <Suspense fallback={<div className="h-8 w-8 rounded-md" />}>
              <AccountIdentityButton auth={auth} />
            </Suspense>
          )}
          <RepoMetric icon="eye" value={compactCount(codeSummary?.watcherCount ?? repos.length)} label="watchers" />
          <RepoMetric icon="fork" value={compactCount(codeSummary?.forkCount ?? 0)} label="forks" />
          <RepoMetric icon="star" value={compactCount(codeSummary?.starCount ?? 0)} label="stars" />
        </div>
      </div>
    );
  }

  if (view === "home") return <div className="app-drag-region h-6 shrink-0 bg-black" />;

  const titles: Record<string, string> = {
    Settings: "Application Settings",
    Status: "GitHub Status",
    "Local Changes": "Local Changes",
    Issues: "Issues",
    "Pull requests": "Pull requests",
    Actions: "Actions",
    "Branch Integrity": "Branch Watch"
  };
  const topTitle = view === "My Work" ? "" : (titles[view] ?? view);

  return (
    <div className="app-drag-region app-top-context flex h-[56px] max-w-full shrink-0 items-center justify-between px-6">
      <div className="app-top-context-primary flex items-center text-[14px] font-medium text-neutral-200">{topTitle}</div>
      <div className="app-no-drag app-top-context-secondary flex items-center gap-3">
        <SyncProgressIndicator
          activeRepos={syncingRepos}
          compact
          open={activeDetails === "sync"}
          onOpenChange={(open) => setActiveDetails(open ? "sync" : null)}
        />
        <GitHubStatusGlow
          status={githubStatus}
          open={activeDetails === "github"}
          onOpenChange={(open) => setActiveDetails(open ? "github" : null)}
        />
        <GitHubSendQueueChrome
          open={activeDetails === "queue"}
          onOpenChange={(open) => setActiveDetails(open ? "queue" : null)}
          onOpenAction={onOpenQueuedAction}
        />
        {richChromeEnabled && <NotificationsChrome auth={auth} onOpenMyWork={onOpenMyWork} onOpenItem={onOpenAttentionItem} />}
        {richChromeEnabled && (
          <Suspense fallback={<div className="h-8 w-8 rounded-md" />}>
            <AccountIdentityButton auth={auth} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function RepoMetric({ icon, value, label }: { icon: "eye" | "fork" | "star"; value: string; label: string }) {
  return (
    <div className="flex items-center space-x-1.5" title={`${value} ${label}`} aria-label={`${value} ${label}`}>
      <ShellIcon name={icon} className="h-4 w-4" />
      <span className="text-neutral-400">{value}</span>
    </div>
  );
}

function SyncProgressIndicator({
  activeRepos,
  compact = false,
  className = "",
  open,
  onOpenChange
}: {
  activeRepos: WatchedRepo[];
  compact?: boolean;
  className?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (activeRepos.length === 0) return null;

  const title = activeRepos.map((repo) => `${repo.fullName}: ${repo.syncProgressMessage ?? syncStatusLabel(repo.syncStatus)}`).join("\n");
  const panelPosition = compact ? "right-0 top-full mt-2 w-96" : "left-0 bottom-full mb-2 w-[420px] max-w-[calc(100vw-2rem)]";

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={`flex cursor-pointer items-center gap-1.5 text-left text-amber-900 transition-colors hover:text-amber-1000 ${compact ? "" : "w-full rounded-md px-2 py-1.5 hover:bg-accent"}`}
        title={title}
        aria-expanded={open}
        aria-label="Show sync details"
      >
        <DotmCircular3
          size={17}
          dotSize={2.5}
          speed={1.6}
          animated
          hoverAnimated={false}
          muted={false}
          bloom={false}
          halo={0}
          ariaLabel="Show sync details"
          opacityBase={0.12}
          opacityMid={0.42}
          opacityPeak={1}
          cellPadding={1.125}
          boxSize={0}
          minSize={0}
        />
      </button>
      {open && (
        <div
          className={`absolute z-40 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-menu ${panelPosition}`}
        >
          <div className="border-b border-border px-3.5 py-2.5">
            <div className="text-[13px] font-medium text-foreground">Sync details</div>
          </div>
          <div className="max-h-72 divide-y divide-border overflow-y-auto">
            {activeRepos.map((repo) => (
              <div key={repo.id} className="px-3.5 py-3 text-[13px]">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 truncate font-medium text-foreground">{repo.fullName}</div>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {syncStatusLabel(repo.syncStatus)}
                  </span>
                </div>
                <div className="mt-1.5 whitespace-normal break-words leading-5 text-muted-foreground">
                  {repo.syncProgressMessage ?? syncStatusLabel(repo.syncStatus)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GitHubStatusGlow({
  status,
  open,
  onOpenChange
}: {
  status: GitHubChromeStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!status) return null;

  const toneClass = status.tone === "red" ? "text-red-900 hover:text-red-1000" : "text-amber-900 hover:text-amber-1000";
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={`flex h-8 w-8 cursor-pointer items-center justify-center text-left transition-colors ${toneClass}`}
        aria-expanded={open}
        aria-label="Show GitHub status"
        title={`${status.label}: ${status.message}`}
      >
        {status.icon === "airplane" ? (
          <ShellIcon name="airplane" className="h-[18px] w-[18px]" />
        ) : (
          <MiniActivitySignal ariaLabel={status.label} tone={status.tone} />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-menu">
          <div className="border-b border-border px-3.5 py-2.5">
            <div className="text-[13px] font-medium text-foreground">GitHub status</div>
          </div>
          <div className="px-3.5 py-3 text-[13px]">
            <div className="font-medium text-foreground">{status.label}</div>
            <div className="mt-1.5 whitespace-normal break-words leading-5 text-muted-foreground">{status.message}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniActivitySignal({ ariaLabel, tone }: { ariaLabel: string; tone: "orange" | "red" }) {
  const colorClass = tone === "red" ? "bg-red-400" : "bg-amber-300";
  return (
    <span className="grid h-[17px] w-[17px] grid-cols-3 grid-rows-3 gap-px" role="img" aria-label={ariaLabel}>
      {Array.from({ length: 9 }, (_, index) => (
        <span
          key={index}
          className={`h-1 w-1 rounded-full ${colorClass} ${index % 2 === 0 ? "opacity-90" : "opacity-35"} motion-safe:animate-pulse`}
          style={{ animationDelay: `${index * 90}ms` }}
        />
      ))}
    </span>
  );
}

function GitHubSendQueueChrome({
  open,
  onOpenChange,
  onOpenAction
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAction: (action: OfflineAction) => void;
}) {
  const { summary, actions, refresh } = useOfflineActionQueue(open);
  const [filter, setFilter] = useState<"active" | "blocked" | "sent">("active");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [draftEvent, setDraftEvent] = useState<"APPROVE" | "COMMENT" | "REQUEST_CHANGES">("COMMENT");
  const [draftPayload, setDraftPayload] = useState<OfflineActionPayload | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const activeCount = summary.active;
  const blockedCount = summary.blocked;

  useEffect(() => {
    const onOnline = () => void window.fallback.offlineActions.flush().finally(refresh);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refresh]);

  useEffect(() => {
    if (!open && activeCount === 0) return;
    const update = () => setNowMs(Date.now());
    update();
    const id = window.setInterval(update, 1_000);
    return () => window.clearInterval(id);
  }, [activeCount, open]);

  const visible = actions.filter((action) => {
    if (filter === "blocked") return action.status === "blocked";
    if (filter === "sent") return action.status === "sent" || action.status === "cancelled";
    return offlineActionIsActive(action.status);
  });
  const groupedVisible = React.useMemo(() => groupQueuedActions(visible), [visible]);
  const toneClass =
    blockedCount > 0
      ? "text-red-900 hover:text-red-1000"
      : activeCount > 0
        ? "text-amber-900 hover:text-amber-1000"
        : "text-neutral-500 hover:text-neutral-200";
  const nextRetry = summary.nextAttemptAt && nowMs > 0 ? Math.max(0, Math.round((Date.parse(summary.nextAttemptAt) - nowMs) / 1000)) : null;

  if (activeCount === 0 && !open) return null;

  const beginEdit = (action: OfflineAction) => {
    setEditingId(action.id);
    setDraftBody(action.body);
    setDraftEvent(action.payload.actionType === "pr_review" ? action.payload.event : "COMMENT");
    setDraftPayload(action.payload);
  };
  const saveEdit = async (action: OfflineAction) => {
    const nextPayload = draftPayload ?? action.payload;
    const body = previewBodyForPayload(nextPayload, draftBody).trim();
    if (!body) return;
    await window.fallback.offlineActions.update(action.id, { body, payload: updatedPayload(nextPayload, draftBody.trim(), draftEvent) });
    setEditingId(null);
    setDraftPayload(null);
    await refresh();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={`relative flex h-8 w-8 cursor-pointer items-center justify-center transition-colors ${toneClass}`}
        aria-expanded={open}
        aria-label="Show GitHub send queue"
        title={activeCount > 0 ? `${activeCount} queued GitHub write${activeCount === 1 ? "" : "s"}` : "GitHub send queue"}
      >
        <ShellIcon name="queue" className="h-[18px] w-[18px]" />
        {activeCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full border border-black bg-background-100 px-1 text-[10px] font-semibold leading-4 text-foreground shadow-border-small">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[440px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-menu">
          <div className="border-b border-border px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-medium text-foreground">GitHub send queue</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {activeCount} active{blockedCount > 0 ? ` · ${blockedCount} blocked` : ""}
                  {nextRetry != null && activeCount > 0 ? ` · retry in ${nextRetry}s` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void window.fallback.offlineActions.flush().finally(refresh)}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Retry due
              </button>
            </div>
            <div className="mt-3 flex gap-1">
              {(["active", "blocked", "sent"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`rounded-md px-2 py-1 text-[11px] capitalize transition-colors ${
                    filter === value ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[460px] divide-y divide-border overflow-y-auto">
            {visible.length === 0 ? (
              <div className="px-3.5 py-8 text-center text-[13px] text-muted-foreground">No queued GitHub writes.</div>
            ) : (
              groupedVisible.map((group) => (
                <div key={group.key} className="divide-y divide-border">
                  <div className="bg-background-100/70 px-3.5 py-1.5 text-[11px] font-medium text-muted-foreground">{group.label}</div>
                  {group.actions.map((action) => {
                    const editing = editingId === action.id;
                    const canRetry = offlineActionCanRetry(action);
                    return (
                      <div
                        key={action.id}
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (editing) return;
                          if (event.key === "Enter") onOpenAction(action);
                          if (event.key.toLowerCase() === "e" && offlineActionCanEdit(action)) beginEdit(action);
                          if (event.key.toLowerCase() === "r" && canRetry)
                            void window.fallback.offlineActions.retry(action.id).finally(refresh);
                          if (event.key === "Delete" && action.status !== "sent") void confirmCancelQueuedAction(action, refresh);
                        }}
                        className="px-3.5 py-3 text-[13px] outline-none transition-colors focus-visible:bg-accent/50"
                      >
                        <div className="flex items-start gap-3">
                          <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${queueStatusDot(action.status)}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="font-medium text-foreground">{offlineActionLabel(action.actionType)}</span>
                              <span className="truncate font-mono text-[11px] text-muted-foreground">
                                {action.repoFullName ?? action.repoId} #{action.entityNumber}
                              </span>
                              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{queueStatusLabel(action.status)}</span>
                            </div>
                            {editing ? (
                              <div className="mt-2 space-y-2">
                                {draftPayload?.actionType === "pr_review" && (
                                  <select
                                    value={draftEvent}
                                    onChange={(event) => {
                                      const eventValue = event.currentTarget.value as typeof draftEvent;
                                      setDraftEvent(eventValue);
                                      setDraftPayload((current) =>
                                        current?.actionType === "pr_review" ? { ...current, event: eventValue } : current
                                      );
                                    }}
                                    className="h-8 rounded-md border border-border bg-background-100 px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  >
                                    <option value="APPROVE">Approve</option>
                                    <option value="COMMENT">Comment</option>
                                    <option value="REQUEST_CHANGES">Request changes</option>
                                  </select>
                                )}
                                <textarea
                                  value={draftBody}
                                  onChange={(event) => {
                                    setDraftBody(event.currentTarget.value);
                                    setDraftPayload((current) =>
                                      current?.actionType === "pr_review" ? { ...current, body: event.currentTarget.value } : current
                                    );
                                  }}
                                  className="min-h-24 w-full resize-y rounded-md border border-border bg-background-100 px-2 py-2 text-[13px] leading-5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                                {draftPayload?.actionType === "pr_review" && draftPayload.comments && draftPayload.comments.length > 0 && (
                                  <div className="space-y-2 rounded-md border border-border bg-background-100 p-2">
                                    <div className="text-[11px] font-medium text-muted-foreground">
                                      {draftPayload.comments.length} inline comment{draftPayload.comments.length === 1 ? "" : "s"}
                                    </div>
                                    {draftPayload.comments.map((comment, index) => (
                                      <div
                                        key={`${comment.path}:${comment.line}:${index}`}
                                        className="rounded-md border border-border bg-background px-2 py-2"
                                      >
                                        <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                          <span className="min-w-0 truncate font-mono">
                                            {comment.path}:{comment.line}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setDraftPayload((current) =>
                                                current?.actionType === "pr_review"
                                                  ? {
                                                      ...current,
                                                      comments: current.comments?.filter((_, itemIndex) => itemIndex !== index)
                                                    }
                                                  : current
                                              )
                                            }
                                            className="rounded px-1.5 py-0.5 text-red-900 transition-colors hover:bg-red-200/20"
                                          >
                                            Remove
                                          </button>
                                        </div>
                                        <textarea
                                          value={comment.body}
                                          onChange={(event) =>
                                            setDraftPayload((current) =>
                                              current?.actionType === "pr_review"
                                                ? {
                                                    ...current,
                                                    comments: current.comments?.map((item, itemIndex) =>
                                                      itemIndex === index ? { ...item, body: event.currentTarget.value } : item
                                                    )
                                                  }
                                                : current
                                            )
                                          }
                                          className="min-h-16 w-full resize-y rounded-md border border-border bg-background-100 px-2 py-1.5 text-[12px] leading-5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {action.payload.actionType === "pr_review" && action.upstreamLastSeenSha && (
                                  <div className="rounded-md border border-amber-700/30 bg-amber-200/20 px-2 py-1.5 text-[11px] leading-4 text-amber-900">
                                    This review was queued against {action.upstreamLastSeenSha.slice(0, 7)}. If the PR changed, inline
                                    comments may need confirmation.
                                  </div>
                                )}
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setEditingId(null)}
                                    className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void saveEdit(action)}
                                    disabled={!previewBodyForPayload(draftPayload ?? action.payload, draftBody).trim()}
                                    className="rounded-md border border-border bg-foreground px-2 py-1 text-[11px] font-medium text-background disabled:opacity-50"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="mt-1.5 line-clamp-2 break-words leading-5 text-muted-foreground">
                                  {offlineActionPreview(action.body) || "No body"}
                                </div>
                                {action.lastError && (
                                  <div className="mt-1.5 rounded-md border border-amber-700/30 bg-amber-200/20 px-2 py-1.5 text-[11px] leading-4 text-amber-900">
                                    {action.lastError}
                                  </div>
                                )}
                                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                  <span>{formatRelative(action.updatedAt)}</span>
                                  <div className="flex shrink-0 items-center gap-1">
                                    <QueueIconButton label="Open source" icon="external" onClick={() => onOpenAction(action)} />
                                    {offlineActionCanEdit(action) && (
                                      <QueueIconButton label="Edit queued write" icon="edit" onClick={() => beginEdit(action)} />
                                    )}
                                    {canRetry && (
                                      <QueueIconButton
                                        label="Retry now"
                                        icon="rotate"
                                        onClick={() => void window.fallback.offlineActions.retry(action.id).finally(refresh)}
                                      />
                                    )}
                                    {action.status !== "sent" && (
                                      <QueueIconButton
                                        label="Delete queued write"
                                        icon="trash"
                                        destructive
                                        onClick={() => void confirmCancelQueuedAction(action, refresh)}
                                      />
                                    )}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function useOfflineActionQueue(open: boolean): {
  summary: OfflineActionQueueSummary;
  actions: OfflineAction[];
  refresh: () => Promise<void>;
} {
  const empty: OfflineActionQueueSummary = {
    queued: 0,
    sending: 0,
    retryable: 0,
    blocked: 0,
    sent: 0,
    cancelled: 0,
    active: 0,
    nextAttemptAt: null
  };
  const [summary, setSummary] = useState<OfflineActionQueueSummary>(empty);
  const [actions, setActions] = useState<OfflineAction[]>([]);

  const refresh = React.useCallback(async () => {
    const nextSummary = await window.fallback.offlineActions.summary();
    setSummary(nextSummary);
    if (open || nextSummary.active > 0) {
      setActions(await window.fallback.offlineActions.list({ includeCompleted: open }));
    }
  }, [open]);

  useEffect(() => {
    void refresh();
    return window.fallback.events.onOfflineActionsChanged(() => void refresh());
  }, [refresh]);

  return { summary, actions, refresh };
}

function QueueIconButton({
  label,
  icon,
  destructive,
  onClick
}: {
  label: string;
  icon: "edit" | "external" | "rotate" | "trash";
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        destructive ? "text-red-900 hover:bg-red-200/20" : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <ShellIcon name={icon} className="h-3.5 w-3.5" />
    </button>
  );
}

function groupQueuedActions(actions: OfflineAction[]): Array<{ key: string; label: string; actions: OfflineAction[] }> {
  const groups = new Map<string, { key: string; label: string; actions: OfflineAction[] }>();
  for (const action of actions) {
    const key = `${action.repoId}:${action.entityType}:${action.entityNumber}`;
    const label = `${action.repoFullName ?? action.repoId} #${action.entityNumber}`;
    const group = groups.get(key) ?? { key, label, actions: [] };
    group.actions.push(action);
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function confirmCancelQueuedAction(action: OfflineAction, refresh: () => Promise<void>): Promise<void> {
  if (!window.confirm(`Delete queued ${offlineActionTitle(action)}?`)) return;
  await window.fallback.offlineActions.cancel(action.id);
  await refresh();
}

function previewBodyForPayload(payload: OfflineActionPayload, fallbackBody: string): string {
  if (payload.actionType === "pr_review") {
    return [fallbackBody, ...(payload.comments ?? []).map((comment) => comment.body)].filter((value) => value.trim()).join("\n");
  }
  return fallbackBody;
}

function updatedPayload(
  payload: OfflineActionPayload,
  body: string,
  event: "APPROVE" | "COMMENT" | "REQUEST_CHANGES"
): OfflineActionPayload {
  if (payload.actionType === "pr_review") {
    return {
      ...payload,
      event,
      body,
      comments: payload.comments?.map((comment) => ({ ...comment, body: comment.body.trim() })).filter((comment) => comment.body)
    };
  }
  return { ...payload, body };
}

function queueStatusLabel(status: OfflineAction["status"]): string {
  if (status === "failed_retryable") return "retrying";
  return status.replace("_", " ");
}

function queueStatusDot(status: OfflineAction["status"]): string {
  if (status === "blocked") return "bg-red-500";
  if (status === "sending") return "bg-blue-400 motion-safe:animate-pulse";
  if (status === "sent") return "bg-green-500";
  if (status === "cancelled") return "bg-neutral-600";
  return "bg-amber-400";
}

function NotificationsChrome({
  auth,
  onOpenMyWork,
  onOpenItem
}: {
  auth: AuthState;
  onOpenMyWork: () => void;
  onOpenItem: (item: AttentionItem) => void;
}) {
  const { NotificationInboxButton } = useShellComponents();
  return (
    <Suspense fallback={<div className="h-8 w-8 rounded-md" />}>
      <NotificationInboxButton auth={auth} onOpenMyWork={onOpenMyWork} onOpenItem={onOpenItem} />
    </Suspense>
  );
}

function syncStatusLabel(status: WatchedRepo["syncStatus"]): string {
  if (status === "fresh") return "Synced";
  return status.replace("_", " ");
}

function isRepoScopedView(view: AppView): boolean {
  return (
    view === "Code" ||
    view === "Local Changes" ||
    view === "Issues" ||
    view === "Pull requests" ||
    view === "Actions" ||
    view === "Branch Integrity"
  );
}

function offlineBanner(online: boolean, offline: OfflineStatus | undefined, repos: WatchedRepo[]): string | null {
  if (online) {
    if (!offline || offline.state === "online") return null;
    if (offline.state === "github_degraded") return "GitHub is degraded. Some updates may be delayed.";
    if (offline.state === "github_down" || offline.state === "offline") return "GitHub is unreachable. Using your last synced data.";
    if (offline.state === "unknown_error") return "GitHub status is unclear. Using your last synced data.";
    return offline.message ?? null;
  }
  const latestCacheAt = repos
    .map((repo) => repo.lastSuccessfulSyncAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  return `You're offline. Using cached GitHub data${latestCacheAt ? ` from ${formatDate(latestCacheAt)}` : ""}.`;
}

function githubStatusForChrome(online: boolean, offline: OfflineStatus | undefined, repos: WatchedRepo[]): GitHubChromeStatus {
  if (!online) {
    return {
      tone: "red",
      icon: "airplane",
      label: "Offline",
      message: offlineBanner(false, offline, repos) ?? "You're offline. Using cached GitHub data."
    };
  }

  if (!offline || offline.state === "online") return null;
  if (offline.state === "github_degraded") {
    return {
      tone: "orange",
      icon: "activity",
      label: "GitHub degraded",
      message: offlineBanner(true, offline, repos) ?? "Some updates may be delayed."
    };
  }
  if (offline.state === "github_down" || offline.state === "offline" || offline.state === "unknown_error") {
    return {
      tone: "red",
      icon: "activity",
      label: offline.state === "unknown_error" ? "GitHub status unclear" : "GitHub unreachable",
      message: offlineBanner(true, offline, repos) ?? "Using your last synced data."
    };
  }
  return {
    tone: "orange",
    icon: "activity",
    label: "GitHub attention needed",
    message: offline.message
  };
}
