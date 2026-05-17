import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileDirectoryIcon as GitHubFileDirectoryIcon,
  IssueOpenedIcon as GitHubIssueOpenedIcon,
  PlusIcon as GitHubPlusIcon,
  GitPullRequestIcon as GitHubPullRequestIcon,
  SearchIcon as GitHubSearchIcon
} from "@primer/octicons-react";
import { Check, Database, ExternalLink, LayoutGrid, List, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import type { GitHubRepoSummary, WatchedRepo } from "../../../shared/domain/watched-repo";
import type { RepoGroup } from "../../../shared/domain/repo-group";
import type { LocalChangesSummary } from "../../../shared/domain/local-git";
import type { CacheSummary } from "../../../shared/domain/cache";
import type { BranchIntegrityStatusSummary } from "../../../shared/domain/branch-integrity";
import { identityRisk } from "../../../shared/identity-risk";
import { filterWatchedRepos, sortWatchedRepos } from "../../../shared/repo-display";
import { useNavigationStore } from "../../state/navigation-store";
import { useRepoSelectionStore } from "../../state/repo-selection-store";
import { useAppPreferencesStore } from "../../state/app-store";
import { Avatar } from "../../components/Avatar";
import { CacheTimestamp } from "../../components/CacheTimestamp";
import { IdentityRiskWarning } from "../../components/IdentityRiskWarning";
import { SyncBadge } from "../../components/SyncBadge";
import { SyncLoader } from "../../components/SyncLoader";
import { BranchIntegrityBadge } from "../branch-integrity/BranchIntegrityBadge";
import { compactCount, formatBytes, formatRelative } from "../../lib/format";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";

const DISCONNECTED_AUTH_STATE = { status: "disconnected" } as const;
const ConfirmDialog = React.lazy(() => import("../../components/ConfirmDialog").then((module) => ({ default: module.ConfirmDialog })));
const RepoPicker = React.lazy(() => import("../../components/RepoPicker").then((module) => ({ default: module.RepoPicker })));
const StorageUsageBar = React.lazy(() =>
  import("../../components/StorageUsageBar").then((module) => ({ default: module.StorageUsageBar }))
);
const RepoIdentityControl = React.lazy(() =>
  import("../repo-identity/RepoIdentityControl").then((module) => ({ default: module.RepoIdentityControl }))
);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ---- Home View ---- */

export function HomeView({
  repos,
  reposPending,
  onRepoClick
}: {
  repos: WatchedRepo[];
  reposPending: boolean;
  onRepoClick: (repoId: string) => void;
}) {
  const queryClient = useQueryClient();
  const setView = useNavigationStore((s) => s.setView);
  const selectedRepoId = useRepoSelectionStore((s) => s.selectedRepoId);
  const setSelectedRepoId = useRepoSelectionStore((s) => s.setSelectedRepoId);
  const displayMode = useAppPreferencesStore((s) => s.repoDisplayMode);
  const setDisplayMode = useAppPreferencesStore((s) => s.setRepoDisplayMode);
  const [notice, setNotice] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [addRepoSearch, setAddRepoSearch] = useState("");
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupFocusMode, setGroupFocusMode] = useState(false);
  const [manageGroupsOpen, setManageGroupsOpen] = useState(false);
  const [repoRemovalTarget, setRepoRemovalTarget] = useState<WatchedRepo | null>(null);
  const [repoGroupsEnabled, setRepoGroupsEnabled] = useState(false);
  const [detailedCacheEnabled, setDetailedCacheEnabled] = useState(false);
  const [localChangesSummaryEnabled, setLocalChangesSummaryEnabled] = useState(false);
  const [branchIntegrityEnabled, setBranchIntegrityEnabled] = useState(false);
  const { data: repoGroups = [] } = useQuery({
    queryKey: ["repoGroups"],
    queryFn: window.fallback.repoGroups.list,
    enabled: repoGroupsEnabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false
  });
  useEffect(() => {
    const id = window.setTimeout(() => setRepoGroupsEnabled(true), 1_500);
    return () => window.clearTimeout(id);
  }, []);
  const {
    data: cache,
    isFetching: cacheLoading,
    refetch: refetchCache
  } = useQuery({
    queryKey: ["cache"],
    queryFn: window.fallback.cache.summary,
    initialData: () => queryClient.getQueryData<CacheSummary>(["cache"]),
    staleTime: 30_000,
    refetchOnWindowFocus: false
  });
  const {
    data: detailedCache,
    isFetching: detailedCacheLoading,
    refetch: refetchDetailedCache
  } = useQuery({
    queryKey: ["cacheDetailed"],
    queryFn: window.fallback.cache.summaryDetailed,
    enabled: Boolean(cache && detailedCacheEnabled),
    staleTime: 60_000,
    refetchOnWindowFocus: false
  });
  useEffect(() => {
    if (!cache) return;
    const id = window.setTimeout(() => setDetailedCacheEnabled(true), 8_000);
    return () => window.clearTimeout(id);
  }, [cache]);
  const { data: auth = DISCONNECTED_AUTH_STATE } = useQuery({
    queryKey: ["auth"],
    queryFn: window.fallback.auth.getAuthState,
    enabled: false,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false
  });
  const { data: availableRepos = [], isFetching: reposLoading } = useQuery({
    queryKey: ["availableRepos"],
    queryFn: window.fallback.repos.listAvailable,
    enabled: auth.status === "connected" && (showAddRepo || (!reposPending && repos.length === 0)),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false
  });
  const localRepoIds = useMemo(
    () =>
      repos
        .filter((repo) => repo.localPath)
        .map((repo) => repo.id)
        .sort(),
    [repos]
  );
  const { data: localChanges = [] } = useQuery({
    queryKey: ["localChangesSummary", localRepoIds.join("|")],
    queryFn: () => window.fallback.repos.localChangesSummary(localRepoIds, { includeStats: false }),
    enabled: localRepoIds.length > 0 && localChangesSummaryEnabled,
    staleTime: 15_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true
  });
  useEffect(() => {
    const id = window.setTimeout(() => setLocalChangesSummaryEnabled(true), 2_500);
    return () => window.clearTimeout(id);
  }, []);
  const localChangesByRepo = useMemo(() => new Map(localChanges.map((summary) => [summary.repoId, summary])), [localChanges]);
  const displayedCache = detailedCache ?? cache;
  const { data: branchIntegritySummaries = [] } = useQuery({
    queryKey: ["branchIntegritySummaries", repos.map((repo) => repo.id).join("|")],
    queryFn: () => window.fallback.branchIntegrity.summaryMany(repos.map((repo) => repo.id)),
    enabled: repos.length > 0 && branchIntegrityEnabled,
    staleTime: 30_000,
    refetchInterval: 120_000
  });
  useEffect(() => {
    const id = window.setTimeout(() => setBranchIntegrityEnabled(true), 5_000);
    return () => window.clearTimeout(id);
  }, []);
  const branchIntegrityByRepo = useMemo(
    () => new Map(branchIntegritySummaries.map((summary) => [summary.repoId, summary])),
    [branchIntegritySummaries]
  );
  const watchRepo = useMutation({
    mutationFn: (fullName: string) => window.fallback.repos.watch({ fullName }),
    onSuccess: async (repo) => {
      setAddRepoSearch("");
      setShowAddRepo(false);
      setNotice(`${repo.fullName} is watched. Initial sync queued.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["repos"] }),
        queryClient.invalidateQueries({ queryKey: ["repoGroups"] }),
        queryClient.invalidateQueries({ queryKey: ["cache"] }),
        queryClient.invalidateQueries({ queryKey: ["availableRepos"] })
      ]);
    },
    onError: (error) => setNotice(errorMessage(error))
  });
  const deleteWatchedRepo = useMutation({
    mutationFn: (repoId: string) => window.fallback.cache.deleteRepo(repoId),
    onSuccess: async (_cache, deletedRepoId) => {
      setRepoRemovalTarget(null);
      if (selectedRepoId === deletedRepoId) {
        setSelectedRepoId(null);
        setView("home");
      }
      setNotice("Repository removed from watched repos and local cache.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["repos"] }),
        queryClient.invalidateQueries({ queryKey: ["repoGroups"] }),
        queryClient.invalidateQueries({ queryKey: ["cache"] }),
        queryClient.invalidateQueries({ queryKey: ["availableRepos"] })
      ]);
    },
    onError: (error) => setNotice(errorMessage(error))
  });
  const refreshRepo = useMutation({
    mutationFn: (repoId: string) => window.fallback.repos.refresh(repoId),
    onSuccess: async (_job, repoId) => {
      await queryClient.invalidateQueries({ queryKey: ["repos"] });
      const repo = repos.find((item) => item.id === repoId);
      if (repo?.fullName) {
        queryClient.invalidateQueries({ queryKey: ["repo", repoId] });
      }
    },
    onError: (error) => setNotice(errorMessage(error))
  });
  const visibleRepos = useMemo(
    () =>
      sortWatchedRepos(
        filterWatchedRepos(repos, {
          query: repoSearch,
          groupId: selectedGroupId,
          localChanges: localChangesByRepo
        }),
        "updated",
        localChangesByRepo
      ),
    [localChangesByRepo, repos, repoSearch, selectedGroupId]
  );
  const focusedGroup = selectedGroupId ? repoGroups.find((group) => group.id === selectedGroupId) : null;
  const repoRemovalDialog = repoRemovalTarget ? (
    <React.Suspense fallback={null}>
      <ConfirmDialog
        title="Remove watched repository?"
        objectName={repoRemovalTarget.fullName}
        body={
          <div className="space-y-2">
            <p>This removes the watched repository entry and clears Fallback's local GitHub context for this repository.</p>
            <p>
              {repoRemovalTarget.localPath
                ? "If this repo was cloned into Fallback's workspace, that local clone folder will be removed too."
                : "No local clone is recorded for this watched repository."}
            </p>
          </div>
        }
        confirmLabel="Remove repository"
        pendingLabel="Removing..."
        pending={deleteWatchedRepo.isPending}
        error={deleteWatchedRepo.error ? errorMessage(deleteWatchedRepo.error) : null}
        onCancel={() => {
          if (!deleteWatchedRepo.isPending) setRepoRemovalTarget(null);
        }}
        onConfirm={() => deleteWatchedRepo.mutate(repoRemovalTarget.id)}
      />
    </React.Suspense>
  ) : null;
  const addRepoDialog = (
    <Dialog open={showAddRepo} onOpenChange={setShowAddRepo}>
      <DialogContent
        className="max-h-[86vh] max-w-[min(960px,calc(100vw-32px))] gap-0 overflow-hidden p-0 sm:max-w-[min(960px,calc(100vw-32px))]"
        showCloseButton
      >
        <DialogHeader className="border-b border-gray-alpha-200 px-6 py-5 pr-12">
          <DialogTitle className="text-[17px] font-semibold tracking-[-0.01em]">Add repository</DialogTitle>
          <DialogDescription className="mt-1 text-[13px] leading-5">
            Search accessible repositories or enter a full <span className="font-mono">owner/name</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[calc(86vh-94px)] overflow-y-auto p-5">
          {auth.status === "connected" ? (
            <React.Suspense fallback={<div className="h-48 rounded-md border border-gray-alpha-200 bg-background-200" />}>
              <RepoPicker
                repos={availableRepos}
                watchedRepos={repos}
                loading={reposLoading}
                query={addRepoSearch}
                watching={watchRepo.isPending}
                onQuery={setAddRepoSearch}
                onWatch={(fullName) => watchRepo.mutate(fullName)}
              />
            </React.Suspense>
          ) : (
            <div className="flex items-center justify-between gap-4 rounded-md border border-gray-alpha-300 bg-background-200 px-4 py-3 text-[13px] text-gray-900">
              <span className="leading-5">Connect GitHub to search repositories you can access.</span>
              <button
                onClick={() => setView("Settings")}
                className="h-8 shrink-0 rounded-md bg-gray-1000 px-3 text-[13px] font-medium text-background-200 transition-colors hover:bg-gray-900"
              >
                Connect GitHub
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );

  if (repos.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-6 space-y-6 w-full max-w-5xl mx-auto">
        <h1 className="text-[28px] font-semibold mb-6 text-white tracking-tight">Watched Repositories</h1>
        <HomeStorageUsage
          cache={displayedCache}
          loading={cacheLoading || detailedCacheLoading}
          onRefresh={() => {
            setDetailedCacheEnabled(true);
            void refetchCache();
            void refetchDetailedCache();
          }}
        />
        <RepoGroupFilterBar
          groups={repoGroups}
          selectedGroupId={selectedGroupId}
          focusMode={groupFocusMode}
          onSelectedGroupIdChange={setSelectedGroupId}
          onFocusModeChange={setGroupFocusMode}
          onManage={() => {
            setRepoGroupsEnabled(true);
            setManageGroupsOpen(true);
          }}
        />
        {manageGroupsOpen && (
          <RepoGroupsDialog
            repos={repos}
            groups={repoGroups}
            onClose={() => setManageGroupsOpen(false)}
            onChanged={async () => {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["repoGroups"] }),
                queryClient.invalidateQueries({ queryKey: ["repos"] })
              ]);
            }}
          />
        )}
        {addRepoDialog}
        {repoRemovalDialog}
        {notice && (
          <div className="rounded-lg border border-gray-alpha-300 bg-background-100 p-3 text-sm text-gray-900 flex justify-between items-center">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-gray-800 hover:text-gray-1000 text-xs cursor-pointer">
              x
            </button>
          </div>
        )}
        <div className="border-y border-gray-alpha-200 py-8">
          <div className="mx-auto flex max-w-md flex-col items-center text-center">
            <p className="text-[15px] font-medium text-gray-1000">No repos watched yet</p>
            <p className="mt-1 text-[13px] leading-5 text-gray-800">Add a repository to start syncing GitHub context locally.</p>
            <button
              type="button"
              onClick={() => setShowAddRepo(true)}
              className="mt-4 h-8 rounded-md bg-gray-1000 px-3 text-[13px] font-medium text-background-200 transition-colors hover:bg-gray-900"
            >
              Add repository
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-7 space-y-7 w-full max-w-7xl mx-auto lg:px-10 xl:px-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[25px] font-semibold leading-8 text-gray-1000">Repositories</h1>
          <p className="mt-1 text-[13px] leading-5 text-gray-900">
            {visibleRepos.length === repos.length
              ? `${repos.length} watched repositories`
              : `${visibleRepos.length} of ${repos.length} repositories`}
          </p>
        </div>
        <button
          onClick={() => setShowAddRepo(true)}
          className="grid h-9 w-9 place-items-center rounded-md border border-gray-alpha-300 bg-background-100 text-gray-900 transition-colors hover:border-gray-alpha-500 hover:bg-gray-100 hover:text-gray-1000 cursor-pointer"
          aria-expanded={showAddRepo}
          aria-label="Add repository"
          title="Add repository"
        >
          <GitHubPlusIcon className="w-[14px] h-[14px]" />
        </button>
      </div>
      <HomeStorageUsage
        cache={displayedCache}
        loading={cacheLoading || detailedCacheLoading}
        onRefresh={() => {
          setDetailedCacheEnabled(true);
          void refetchCache();
          void refetchDetailedCache();
        }}
      />
      <RepoGroupFilterBar
        groups={repoGroups}
        selectedGroupId={selectedGroupId}
        focusMode={groupFocusMode}
        onSelectedGroupIdChange={setSelectedGroupId}
        onFocusModeChange={setGroupFocusMode}
        onManage={() => {
          setRepoGroupsEnabled(true);
          setManageGroupsOpen(true);
        }}
      />
      {manageGroupsOpen && (
        <RepoGroupsDialog
          repos={repos}
          groups={repoGroups}
          onClose={() => setManageGroupsOpen(false)}
          onChanged={async () => {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["repoGroups"] }),
              queryClient.invalidateQueries({ queryKey: ["repos"] })
            ]);
          }}
        />
      )}
      {addRepoDialog}
      {repoRemovalDialog}
      {groupFocusMode && focusedGroup && (
        <div className="rounded-md border border-gray-alpha-300 bg-background-100 px-3 py-2 text-sm text-gray-900">
          Focus mode is showing <span className="text-gray-1000">{focusedGroup.name}</span>.
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-gray-alpha-300 bg-background-100 p-3 text-sm text-gray-900 flex justify-between items-center">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-gray-800 hover:text-gray-1000 text-xs cursor-pointer">
            x
          </button>
        </div>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search watched repositories</span>
          <span className="relative min-w-0">
            <GitHubSearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-700" />
            <input
              value={repoSearch}
              onChange={(event) => setRepoSearch(event.target.value)}
              placeholder="Search repositories..."
              spellCheck={false}
              className="h-8 w-full rounded-md border border-gray-alpha-300 bg-background-200 pl-8 pr-3 text-[13px] leading-none text-gray-1000 placeholder:text-gray-700 transition-colors hover:border-gray-alpha-400 focus:border-gray-alpha-600 focus:outline-none"
            />
          </span>
        </label>
        <div className="flex items-center justify-end">
          <div className="flex h-8 rounded-md border border-gray-alpha-300 bg-background-200 p-0.5 text-gray-800">
            {(["cards", "list"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDisplayMode(mode)}
                className={`grid h-7 w-7 place-items-center rounded-[5px] transition-colors ${
                  displayMode === mode ? "bg-gray-alpha-200 text-gray-1000" : "hover:bg-gray-alpha-100 hover:text-gray-1000"
                }`}
                aria-label={`Show repositories as ${mode}`}
                title={`Show repositories as ${mode}`}
              >
                {mode === "cards" ? <LayoutGrid className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        </div>
      </div>
      {visibleRepos.length === 0 ? (
        <div className="rounded-md border border-gray-alpha-300 bg-background-100 px-4 py-8 text-center text-sm text-gray-900">
          No watched repositories match your search.
        </div>
      ) : displayMode === "cards" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {visibleRepos.map((repo) => (
            <RepoCard
              key={repo.id}
              repo={repo}
              localChanges={localChangesByRepo.get(repo.id)}
              branchIntegrity={branchIntegrityByRepo.get(repo.id)}
              deleting={deleteWatchedRepo.isPending}
              refreshing={refreshRepo.isPending}
              onOpen={() => onRepoClick(repo.id)}
              onRefresh={() => refreshRepo.mutate(repo.id)}
              onDelete={() => setRepoRemovalTarget(repo)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-alpha-300 bg-background-100">
          {visibleRepos.map((repo) => (
            <RepoListRow
              key={repo.id}
              repo={repo}
              localChanges={localChangesByRepo.get(repo.id)}
              branchIntegrity={branchIntegrityByRepo.get(repo.id)}
              deleting={deleteWatchedRepo.isPending}
              refreshing={refreshRepo.isPending}
              onOpen={() => onRepoClick(repo.id)}
              onRefresh={() => refreshRepo.mutate(repo.id)}
              onDelete={() => setRepoRemovalTarget(repo)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RepoGroupFilterBar({
  groups,
  selectedGroupId,
  focusMode,
  onSelectedGroupIdChange,
  onFocusModeChange,
  onManage
}: {
  groups: RepoGroup[];
  selectedGroupId: string | null;
  focusMode: boolean;
  onSelectedGroupIdChange: (groupId: string | null) => void;
  onFocusModeChange: (enabled: boolean) => void;
  onManage: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-y border-gray-alpha-200 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={() => onSelectedGroupIdChange(null)}
          className={`h-8 border-b text-[13px] transition-colors ${
            selectedGroupId === null ? "border-gray-1000 text-gray-1000" : "border-transparent text-gray-800 hover:text-gray-1000"
          }`}
        >
          All repos
        </button>
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            onClick={() => onSelectedGroupIdChange(group.id)}
            className={`h-8 border-b text-[13px] transition-colors ${
              selectedGroupId === group.id ? "border-gray-1000 text-gray-1000" : "border-transparent text-gray-800 hover:text-gray-1000"
            }`}
          >
            {group.name}
            <span className="ml-1 font-mono text-[11px] text-gray-700">{compactCount(group.repoIds.length)}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {groups.length > 0 && (
          <label
            className={`flex h-8 items-center gap-2 rounded-md px-2 text-[13px] transition-colors ${
              selectedGroupId ? "text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000" : "text-gray-700"
            }`}
          >
            <Checkbox
              checked={focusMode}
              disabled={!selectedGroupId}
              onCheckedChange={(checked) => onFocusModeChange(checked === true)}
              className="size-3.5"
            />
            Focus
          </label>
        )}
        <button
          type="button"
          onClick={onManage}
          className="h-8 rounded-md border border-gray-alpha-300 bg-background-200 px-2.5 text-[13px] text-gray-900 transition-colors hover:border-gray-alpha-500 hover:bg-gray-alpha-100 hover:text-gray-1000"
        >
          Manage groups
        </button>
      </div>
    </div>
  );
}

function RepoGroupsDialog({
  repos,
  groups,
  onClose,
  onChanged
}: {
  repos: WatchedRepo[];
  groups: RepoGroup[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.id ?? "");
  const [editingNames, setEditingNames] = useState<Record<string, string>>({});
  const [repoFilter, setRepoFilter] = useState("");
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
  const selectedDraftName = selectedGroup ? (editingNames[selectedGroup.id] ?? selectedGroup.name) : "";
  const selectedNameChanged = Boolean(selectedGroup && selectedDraftName.trim() && selectedDraftName !== selectedGroup.name);
  const normalizedRepoFilter = repoFilter.trim().toLowerCase();
  const visibleRepos = useMemo(() => {
    if (!normalizedRepoFilter) return repos;
    return repos.filter((repo) =>
      [repo.fullName, repo.owner, repo.name, repo.description, repo.language].some((value) =>
        value?.toLowerCase().includes(normalizedRepoFilter)
      )
    );
  }, [normalizedRepoFilter, repos]);

  useEffect(() => {
    if (groups.length === 0) {
      if (selectedGroupId) setSelectedGroupId("");
      return;
    }
    if (!selectedGroupId || !groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(groups[0]?.id ?? "");
    }
  }, [groups, selectedGroupId]);

  const createGroup = useMutation({
    mutationFn: (name: string) => window.fallback.repoGroups.create({ name }),
    onSuccess: async (group) => {
      setNewGroupName("");
      setSelectedGroupId(group.id);
      await onChanged();
    }
  });
  const updateGroup = useMutation({
    mutationFn: ({ groupId, name }: { groupId: string; name: string }) => window.fallback.repoGroups.update(groupId, { name }),
    onSuccess: async (group) => {
      setEditingNames((current) => {
        const next = { ...current };
        delete next[group.id];
        return next;
      });
      await onChanged();
    }
  });
  const deleteGroup = useMutation({
    mutationFn: (groupId: string) => window.fallback.repoGroups.delete(groupId),
    onSuccess: async (_result, groupId) => {
      const nextGroup = groups.find((group) => group.id !== groupId);
      setSelectedGroupId(nextGroup?.id ?? "");
      await onChanged();
    }
  });
  const setMemberships = useMutation({
    mutationFn: ({ groupId, repoIds }: { groupId: string; repoIds: string[] }) =>
      window.fallback.repoGroups.setMemberships(groupId, repoIds),
    onSuccess: onChanged
  });
  const error = createGroup.error ?? updateGroup.error ?? deleteGroup.error ?? setMemberships.error;
  const busy = createGroup.isPending || updateGroup.isPending || deleteGroup.isPending || setMemberships.isPending;
  const selectedRepoIds = new Set(selectedGroup?.repoIds ?? []);
  const toggleRepo = (repoId: string) => {
    if (!selectedGroup) return;
    const next = new Set(selectedRepoIds);
    if (next.has(repoId)) next.delete(repoId);
    else next.add(repoId);
    setMemberships.mutate({ groupId: selectedGroup.id, repoIds: [...next] });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[84vh] max-w-4xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-gray-alpha-300 px-5 py-4">
          <div className="flex items-start justify-between gap-8 pr-8">
            <div className="min-w-0">
              <DialogTitle className="text-base">Repo groups</DialogTitle>
              <DialogDescription className="mt-1 text-[13px]">
                Create local groups and choose which watched repositories belong in each one.
              </DialogDescription>
            </div>
            <div className="mt-0.5 hidden shrink-0 items-center gap-2 text-xs text-gray-800 sm:flex">
              <span className="rounded-md border border-gray-alpha-300 bg-background-100 px-2 py-1">
                {compactCount(groups.length)} {groups.length === 1 ? "group" : "groups"}
              </span>
              <span className="rounded-md border border-gray-alpha-300 bg-background-100 px-2 py-1">
                {compactCount(repos.length)} repos
              </span>
            </div>
          </div>
        </DialogHeader>
        <div className="grid max-h-[calc(84vh-73px)] grid-cols-1 overflow-hidden md:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-gray-alpha-300 bg-background-200/35 md:border-b-0 md:border-r">
            <form
              className="flex gap-2 border-b border-gray-alpha-300 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (newGroupName.trim()) createGroup.mutate(newGroupName);
              }}
            >
              <Input
                aria-label="New repository group name"
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.currentTarget.value)}
                placeholder="New group"
                disabled={busy}
                className="h-8 min-w-0 flex-1 rounded-md border-gray-alpha-300 bg-background-100 px-2 text-[13px] text-gray-1000 placeholder:text-gray-700"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={busy || !newGroupName.trim()}
                className="h-8 gap-1.5 border-gray-alpha-400 bg-background-100 px-2.5 text-xs text-gray-1000 hover:bg-gray-alpha-100 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden={true} />
                Add
              </Button>
            </form>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <div className="space-y-1">
                {groups.map((group) => {
                  const selected = selectedGroup?.id === group.id;
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => setSelectedGroupId(group.id)}
                      className={`group flex h-10 w-full items-center justify-between gap-3 rounded-md px-2.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-gray-alpha-500 ${
                        selected ? "bg-gray-alpha-200 text-gray-1000" : "text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000"
                      }`}
                    >
                      <span className="min-w-0 truncate text-[13px] font-medium">{group.name}</span>
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] leading-none ${
                          selected ? "border-gray-alpha-400 text-gray-900" : "border-gray-alpha-300 text-gray-700"
                        }`}
                      >
                        {compactCount(group.repoIds.length)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {groups.length === 0 && (
                <div className="flex min-h-[180px] flex-col items-center justify-center rounded-md border border-dashed border-gray-alpha-300 px-4 text-center">
                  <div className="text-sm font-medium text-gray-1000">No groups yet</div>
                  <div className="mt-1 max-w-[190px] text-[13px] leading-5 text-gray-800">Name a group above to organize repos.</div>
                </div>
              )}
            </div>
          </aside>
          <section className="min-h-[430px] min-w-0 overflow-hidden">
            {selectedGroup ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="border-b border-gray-alpha-300 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <label className="min-w-0 flex-1 space-y-1.5">
                      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-gray-700">Group name</span>
                      <Input
                        aria-label={`Rename group ${selectedGroup.name}`}
                        value={selectedDraftName}
                        onChange={(event) => setEditingNames((current) => ({ ...current, [selectedGroup.id]: event.currentTarget.value }))}
                        className="h-8 rounded-md border-gray-alpha-300 bg-background-100 px-2.5 text-[13px] font-medium text-gray-1000"
                      />
                    </label>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || !selectedNameChanged}
                        onClick={() => updateGroup.mutate({ groupId: selectedGroup.id, name: selectedDraftName })}
                        className="h-8 gap-1.5 border-gray-alpha-400 bg-background-100 px-2.5 text-xs text-gray-1000 hover:bg-gray-alpha-100 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden={true} />
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => deleteGroup.mutate(selectedGroup.id)}
                        className="h-8 gap-1.5 px-2.5 text-xs text-red-400 hover:bg-red-950/30 hover:text-red-300 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden={true} />
                        Delete
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-[13px] text-gray-800">
                      <span className="font-mono text-gray-1000">{compactCount(selectedGroup.repoIds.length)}</span> of{" "}
                      {compactCount(repos.length)} watched repos selected
                    </div>
                    <div className="relative sm:w-64">
                      <Search
                        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-700"
                        aria-hidden={true}
                      />
                      <Input
                        aria-label="Filter repositories"
                        value={repoFilter}
                        onChange={(event) => setRepoFilter(event.currentTarget.value)}
                        placeholder="Filter repos"
                        className="h-8 rounded-md border-gray-alpha-300 bg-background-100 pl-8 pr-2 text-[13px] text-gray-1000 placeholder:text-gray-700"
                      />
                    </div>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <div className="divide-y divide-gray-alpha-200 overflow-hidden rounded-md border border-gray-alpha-300 bg-background-100">
                    {visibleRepos.map((repo) => {
                      const checked = selectedRepoIds.has(repo.id);
                      return (
                        <label
                          key={repo.id}
                          className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 px-3 py-2.5 transition-colors hover:bg-gray-alpha-100 ${
                            checked ? "bg-gray-alpha-100/60" : "bg-transparent"
                          }`}
                        >
                          <Checkbox checked={checked} disabled={busy} onCheckedChange={() => toggleRepo(repo.id)} className="mt-0.5" />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium text-gray-1000">{repo.fullName}</span>
                            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-gray-700">
                              {repo.language && <span className="truncate">{repo.language}</span>}
                              {repo.defaultBranch && <span className="truncate font-mono">{repo.defaultBranch}</span>}
                              {repo.isPrivate && <span className="shrink-0 rounded border border-gray-alpha-300 px-1">Private</span>}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                    {visibleRepos.length === 0 && (
                      <div className="px-4 py-10 text-center text-[13px] text-gray-800">No repositories match this filter.</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[430px] items-center justify-center p-8 text-center">
                <div>
                  <div className="text-sm font-medium text-gray-1000">Create a group to get started</div>
                  <div className="mt-1 max-w-sm text-[13px] leading-5 text-gray-800">
                    Groups are local to this workspace and help filter your watched repositories.
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
        {error && <div className="border-t border-red-700/30 px-4 py-2 text-xs text-red-900">{errorMessage(error)}</div>}
      </DialogContent>
    </Dialog>
  );
}

function RepoCard({
  repo,
  localChanges,
  branchIntegrity,
  deleting,
  refreshing,
  onOpen,
  onRefresh,
  onDelete
}: {
  repo: WatchedRepo;
  localChanges?: LocalChangesSummary;
  branchIntegrity?: BranchIntegrityStatusSummary;
  deleting: boolean;
  refreshing: boolean;
  onOpen: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="group flex flex-col rounded-lg border border-gray-alpha-300 bg-background-100 transition-colors hover:border-gray-alpha-500 hover:bg-gray-alpha-100 focus-within:border-gray-alpha-500">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col p-4 text-left">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar seed={repo.owner} src={repo.ownerAvatarUrl} size="md" />
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-[15px] font-medium text-gray-1000">
                <span className="truncate">{repo.fullName}</span>
                <RepoMetadataBadges repo={repo} />
              </div>
              <RepoGroupBadges groups={repo.groups} />
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-800">
                <span>{repo.defaultBranch ?? "No default branch"}</span>
                <span>{repo.language ?? "Language unknown"}</span>
                <span>{repo.pushedAt ? `pushed ${formatRelative(repo.pushedAt)}` : "push time unknown"}</span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <SyncBadge status={repo.syncStatus} />
            <BranchIntegrityBadge summary={branchIntegrity} compact />
          </div>
        </div>
        <p className="mb-5 min-h-[40px] flex-1 text-sm leading-5 text-gray-900 line-clamp-2">
          {repo.description ?? "Cached GitHub context stored locally."}
        </p>
      </button>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-gray-alpha-200 bg-gray-alpha-100 px-4 pb-4 pt-3 text-xs text-gray-900">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <RepoContextMeta repo={repo} localChanges={localChanges} />
        </button>
        <RepoQuickActions
          repo={repo}
          deleting={deleting}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onDelete={onDelete}
          showIdentityControl
        />
      </div>
    </article>
  );
}

function RepoListRow({
  repo,
  localChanges,
  branchIntegrity,
  deleting,
  refreshing,
  onOpen,
  onRefresh,
  onDelete
}: {
  repo: WatchedRepo;
  localChanges?: LocalChangesSummary;
  branchIntegrity?: BranchIntegrityStatusSummary;
  deleting: boolean;
  refreshing: boolean;
  onOpen: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="repo-list-row group relative grid min-h-[68px] grid-cols-1 border-b border-gray-alpha-200 transition-colors last:border-b-0 hover:bg-gray-alpha-100 focus-within:bg-gray-alpha-100 md:grid-cols-[minmax(300px,1fr)_minmax(260px,0.82fr)_minmax(116px,auto)] md:items-center">
      <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-3 px-5 py-3.5 text-left">
        <Avatar seed={repo.owner} src={repo.ownerAvatarUrl} size="md" />
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12.75px] font-medium leading-[18px] text-gray-1000">
            <span className="truncate">{repo.fullName}</span>
            <RepoMetadataBadges repo={repo} />
          </div>
          <RepoGroupBadges groups={repo.groups} />
          <p className="truncate text-[12px] leading-[17px] text-gray-900">{repo.description ?? "Cached GitHub context stored locally."}</p>
        </div>
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-1 px-5 pb-3 text-left md:grid-cols-[96px_76px_minmax(0,1fr)] md:px-0 md:py-3.5"
      >
        <span className="truncate text-[12px] leading-[17px] text-gray-900">{repo.language ?? "Language unknown"}</span>
        <span className="truncate text-[12px] leading-[17px] text-gray-900">{repo.defaultBranch ?? "No default branch"}</span>
        <span className="truncate text-[12px] leading-[17px] text-gray-900">
          {repo.pushedAt ? `pushed ${formatRelative(repo.pushedAt)}` : "push unknown"}
        </span>
        {localChanges?.isDirty && (
          <span className="col-span-2 flex min-w-0 md:col-span-3">
            <LocalChangesBadge localChanges={localChanges} />
          </span>
        )}
      </button>
      <div className="flex items-center justify-between gap-3 px-5 pb-3.5 transition-opacity md:justify-end md:py-3.5 md:pl-0 md:pr-5 md:group-hover:opacity-0 md:group-focus-within:opacity-0">
        <SyncBadge status={repo.syncStatus} />
        <BranchIntegrityBadge summary={branchIntegrity} compact />
      </div>
      <div className="flex items-center justify-end px-5 pb-3.5 md:absolute md:right-4 md:top-1/2 md:z-10 md:-translate-y-1/2 md:p-0">
        <RepoQuickActions repo={repo} deleting={deleting} refreshing={refreshing} onRefresh={onRefresh} onDelete={onDelete} />
      </div>
    </article>
  );
}

function RepoMetadataBadges({
  repo
}: {
  repo: Pick<GitHubRepoSummary, "isPrivate" | "visibility" | "isFork" | "archived" | "isTemplate">;
}) {
  const badges = [repo.isPrivate ? "Private" : repo.visibility === "internal" ? "Internal" : "Public"];
  if (repo.isFork) badges.push("Fork");
  if (repo.archived) badges.push("Archived");
  if (repo.isTemplate) badges.push("Template");
  return (
    <>
      {badges.map((badge) => (
        <span
          key={badge}
          className="rounded border border-gray-alpha-300 bg-gray-alpha-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-normal text-gray-900"
        >
          {badge}
        </span>
      ))}
    </>
  );
}

function RepoGroupBadges({ groups }: { groups: WatchedRepo["groups"] }) {
  if (groups.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {groups.map((group) => (
        <span key={group.id} className="rounded border border-gray-alpha-300 bg-gray-alpha-100 px-1.5 py-0.5 text-[10px] text-gray-900">
          {group.name}
        </span>
      ))}
    </div>
  );
}

function RepoContextMeta({ repo, localChanges }: { repo: WatchedRepo; localChanges?: LocalChangesSummary }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-gray-900">
      <span className="flex items-center gap-1">
        <GitHubIssueOpenedIcon className="h-3.5 w-3.5" />
        {compactCount(repo.openIssues)}
      </span>
      <span className="flex items-center gap-1">
        <GitHubPullRequestIcon className="h-3.5 w-3.5" />
        {compactCount(repo.openPullRequests)}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <Database className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          {repo.lastSuccessfulSyncAt ? <CacheTimestamp cachedAt={repo.lastSuccessfulSyncAt} state="cached" /> : "No cache"}
        </span>
      </span>
      {localChanges?.isDirty && <LocalChangesBadge localChanges={localChanges} compact />}
    </div>
  );
}

function LocalChangesBadge({ localChanges, compact = false }: { localChanges: LocalChangesSummary; compact?: boolean }) {
  const additions = localChanges.additions > 0 ? `+${compactCount(localChanges.additions)}` : null;
  const deletions = localChanges.deletions > 0 ? `-${compactCount(localChanges.deletions)}` : null;
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md border border-neutral-700/80 bg-neutral-900/80 text-neutral-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${
        compact ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-[11px] font-medium"
      }`}
      title={localChangesSummaryTitle(localChanges)}
    >
      <span className="truncate">
        {localChanges.fileCount === 1 ? "1 file changed" : `${compactCount(localChanges.fileCount)} files changed`}
      </span>
      {(additions || deletions) && (
        <span className="flex shrink-0 items-center gap-1 font-mono">
          {additions && <span style={{ color: "#3fb950" }}>{additions}</span>}
          {deletions && <span style={{ color: "#ff7b72" }}>{deletions}</span>}
        </span>
      )}
    </span>
  );
}

function localChangesSummaryTitle(localChanges: LocalChangesSummary): string {
  const stats = [
    `${localChanges.fileCount} ${localChanges.fileCount === 1 ? "changed file" : "changed files"}`,
    localChanges.additions > 0 ? `${localChanges.additions} additions` : null,
    localChanges.deletions > 0 ? `${localChanges.deletions} deletions` : null
  ].filter(Boolean);
  return stats.join(", ");
}

function RepoQuickActions({
  repo,
  deleting,
  refreshing,
  onRefresh,
  onDelete,
  showIdentityControl = false
}: {
  repo: WatchedRepo;
  deleting: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onDelete: () => void;
  showIdentityControl?: boolean;
}) {
  const [syncRiskOpen, setSyncRiskOpen] = useState(false);
  const [identityHydrationEnabled, setIdentityHydrationEnabled] = useState(false);
  useEffect(() => {
    if (!repo.isPrivate) {
      setIdentityHydrationEnabled(false);
    }
  }, [repo.id, repo.isPrivate]);
  const { data: syncIdentity } = useQuery({
    queryKey: ["repoIdentity", repo.id],
    queryFn: () => window.fallback.repos.getIdentity(repo.id, "home-quick-actions"),
    enabled: repo.isPrivate && identityHydrationEnabled
  });
  const syncRisk = repo.isPrivate ? identityRisk(syncIdentity, "sync") : null;
  const hasSyncRisk = Boolean(syncRisk && syncRisk.level === "warning");
  const runRefresh = () => {
    setSyncRiskOpen(false);
    onRefresh();
  };

  return (
    <div
      className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
      onMouseEnter={() => setIdentityHydrationEnabled(true)}
      onFocus={() => setIdentityHydrationEnabled(true)}
    >
      {showIdentityControl && repo.isPrivate && identityHydrationEnabled && (
        <div title="Identity used for private repo sync">
          <React.Suspense fallback={null}>
            <RepoIdentityControl repoId={repo.id} compact allowApply={false} />
          </React.Suspense>
        </div>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (hasSyncRisk && !syncRiskOpen) {
              setSyncRiskOpen(true);
              return;
            }
            runRefresh();
          }}
          disabled={refreshing}
          className="grid h-7 w-7 place-items-center rounded-md text-gray-800 transition-colors hover:bg-gray-200 hover:text-gray-1000 disabled:cursor-wait disabled:opacity-50"
          title={refreshing ? `Sync for ${repo.fullName} is already queued or running.` : `Sync ${repo.fullName}`}
          aria-label={`Sync ${repo.fullName}`}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        {syncRiskOpen && syncRisk && hasSyncRisk && (
          <div className="absolute right-0 z-40 mt-2 w-80 rounded-lg border border-gray-alpha-300 bg-background-100 p-3 shadow-menu">
            <div className="mb-2 text-xs font-medium text-gray-900">Private repo sync identity</div>
            <IdentityRiskWarning risk={syncRisk} />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSyncRiskOpen(false)}
                className="h-8 rounded-md border border-gray-alpha-300 px-2.5 text-xs font-medium text-gray-900 transition-colors hover:bg-gray-100 hover:text-gray-1000"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runRefresh}
                disabled={refreshing}
                className="h-8 rounded-md bg-gray-1000 px-2.5 text-xs font-semibold text-background-200 transition-colors hover:bg-gray-900 disabled:cursor-wait disabled:bg-gray-alpha-200 disabled:text-gray-700"
              >
                {refreshing ? <SyncLoader size={14} dotSize={2} className="text-amber-300" /> : "Sync anyway"}
              </button>
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (repo.localPath) void window.fallback.shell.openPath(repo.localPath);
        }}
        disabled={!repo.localPath}
        className="grid h-7 w-7 place-items-center rounded-md text-gray-800 transition-colors hover:bg-gray-200 hover:text-gray-1000 disabled:cursor-not-allowed disabled:opacity-30"
        title={repo.localPath ? `Open local folder for ${repo.fullName}` : "No local folder"}
        aria-label={`Open local folder for ${repo.fullName}`}
      >
        <GitHubFileDirectoryIcon className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (repo.htmlUrl) void window.fallback.shell.openExternal(repo.htmlUrl);
        }}
        disabled={!repo.htmlUrl}
        className="grid h-7 w-7 place-items-center rounded-md text-gray-800 transition-colors hover:bg-gray-200 hover:text-gray-1000 disabled:cursor-not-allowed disabled:opacity-30"
        title={repo.htmlUrl ? `Open ${repo.fullName} on GitHub` : "No GitHub URL is cached for this repository."}
        aria-label={`Open ${repo.fullName} on GitHub`}
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        disabled={deleting}
        className="grid h-7 w-7 place-items-center rounded-md text-gray-800 transition-colors hover:bg-red-200 hover:text-red-900 disabled:cursor-wait disabled:opacity-50"
        title={deleting ? `Removing ${repo.fullName} and clearing local cache.` : `Remove ${repo.fullName} and clear local cache`}
        aria-label={`Remove ${repo.fullName}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function HomeStorageUsage({ cache, loading, onRefresh }: { cache?: CacheSummary; loading: boolean; onRefresh: () => void }) {
  return (
    <div className="border-y border-gray-alpha-200 py-3">
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="text-gray-900">Storage</span>
          <span className="font-mono text-gray-1000">{cache ? formatBytes(cache.totalBytes) : loading ? "Counting..." : "Not loaded"}</span>
          {cache && (
            <span className="hidden truncate text-gray-800 sm:inline">
              {cache.watchedRepos} repos · {cache.pullRequests} PRs · {cache.issues} issues
            </span>
          )}
        </div>
        <div className="min-w-[120px] flex-1">
          {cache ? (
            <React.Suspense fallback={<div className="h-1 w-full rounded-full bg-gray-alpha-200" />}>
              <StorageUsageBar cache={cache} compact />
            </React.Suspense>
          ) : (
            <div className="h-1 w-full rounded-full bg-gray-alpha-200" />
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="shrink-0 text-xs text-gray-900 hover:text-gray-1000 cursor-pointer disabled:opacity-50"
        >
          {loading ? "Counting" : "Refresh"}
        </button>
      </div>
    </div>
  );
}

/* ---- Code View (Overview / Commits) ---- */
