import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon as GitHubCheckIcon,
  CodeIcon as GitHubCodeIcon,
  CommentDiscussionIcon as GitHubCommentIcon,
  FileIcon as GitHubFileIcon,
  GitCommitIcon as GitHubCommitIcon,
  GitPullRequestIcon as GitHubPullRequestIcon,
  IssueOpenedIcon as GitHubIssueOpenedIcon,
  MarkGithubIcon,
  RepoIcon as GitHubRepoIcon,
  SearchIcon as GitHubSearchIcon,
  WorkflowIcon as GitHubWorkflowIcon
} from "@primer/octicons-react";
import { ArrowLeft, ChevronRight, ExternalLink, FolderOpen, Loader2, Plus, RotateCcw, Terminal, X } from "lucide-react";
import { toast } from "sonner";
import type { GitHubRepoSummary, WatchedRepo } from "../../../shared/domain/watched-repo";
import type { RepoGroup } from "../../../shared/domain/repo-group";
import type { CommitSearchHit, RepoFileEntry } from "../../../shared/domain/repo-code";
import type { LocalChangesSummary } from "../../../shared/domain/local-git";
import type { OperationRecord } from "../../../shared/domain/operation";
import type { SearchResult, TimelineComment } from "../../../shared/domain/github-work";
import { parseCommitSearchQuery } from "../../../shared/commit-history-search";
import type { AppView } from "../../state/navigation-store";
import type { AppSettings } from "../../../shared/domain/settings";
import { useNavigationStore } from "../../state/navigation-store";
import { useRepoSelectionStore } from "../../state/repo-selection-store";
import { useAppPreferencesStore } from "../../state/app-store";
import { fallbackSettings } from "../../app/default-settings";
import { invalidateRepoWorkFreshness } from "../../app/query-freshness";
import { compactCount, shortSha } from "../../lib/format";
import {
  buildCoreActionCatalog,
  buildCurrentRepoActionCatalog,
  buildLocalChangesSubmenuCatalog,
  buildSyncSubmenuCatalog,
  commandActionItem
} from "./CommandPalette.action-catalog";
import { Command, CommandInput } from "../../components/ui/command";
import { searchCommitsWithCancellation } from "../repo-code/commit-search";
import { sortRepoFiles } from "../repo-code/repo-paths";
import {
  actionQuery,
  detectPaletteMode,
  filterAndRankItems,
  filterGroups,
  flattenGroups,
  normalizePaletteQuery,
  paletteGroupFilter,
  repoPickerQuery,
  resolveShortcutChord,
  stripPaletteGroupFilter
} from "./CommandPalette.logic";
import { CommandPaletteResults, KeyCap } from "./CommandPaletteResults";
import type { CommandPaletteGroup, CommandPaletteItem, CommandPaletteViewId } from "./CommandPalette.types";

type PaletteView = { id: CommandPaletteViewId; title: string };
type PaletteFileResult = { repo: WatchedRepo; file: RepoFileEntry };

const rootView: PaletteView = { id: "root", title: "Fallback" };

export function CommandPalette({
  onClose,
  onOpenResult,
  onOpenFile,
  onOpenCommit
}: {
  onClose: () => void;
  onOpenResult: (result: SearchResult) => void;
  onOpenFile: (repoId: string, path: string) => void;
  onOpenCommit: (repoId: string, sha: string) => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [scopedRepoId, setScopedRepoId] = useState<string | null>(null);
  const [viewStack, setViewStack] = useState<PaletteView[]>([rootView]);
  const [runningValue, setRunningValue] = useState<string | null>(null);
  const [focusInputRequest, setFocusInputRequest] = useState(0);
  const [shortcutKeys, setShortcutKeys] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const shortcutTimeoutRef = useRef<number | null>(null);
  const selectedRepoId = useRepoSelectionStore((s) => s.selectedRepoId);
  const activeView = useNavigationStore((s) => s.view);
  const recentRepoIds = useRepoSelectionStore((s) => s.recentRepoIds);
  const setSelectedRepoId = useRepoSelectionStore((s) => s.setSelectedRepoId);
  const setMyWorkLane = useAppPreferencesStore((s) => s.setMyWorkLane);
  const setView = useNavigationStore((s) => s.setView);
  const currentView = viewStack.at(-1) ?? rootView;
  const trimmed = normalizePaletteQuery(query);
  const deferredTrimmed = useDeferredValue(trimmed);
  const mode = currentView.id === "root" ? detectPaletteMode(deferredTrimmed) : "root";
  const { data: repos = [] } = useQuery({ queryKey: ["repos"], queryFn: window.fallback.repos.listWatched });
  const { data: settings = fallbackSettings } = useQuery<AppSettings>({
    queryKey: ["settings"],
    queryFn: window.fallback.settings.get,
    staleTime: 30_000
  });
  const commandPaletteKeybindings = settings.keybindings?.commandPalette ?? fallbackSettings.keybindings.commandPalette;
  const { data: repoGroups = [] } = useQuery({ queryKey: ["repoGroups"], queryFn: window.fallback.repoGroups.list });
  const groupFilter = currentView.id === "root" ? paletteGroupFilter(deferredTrimmed, repoGroups) : null;
  const searchQuery = groupFilter ? stripPaletteGroupFilter(deferredTrimmed) : deferredTrimmed;
  const paletteQuery = mode === "action" ? actionQuery(searchQuery) : mode === "repo-picker" ? repoPickerQuery(searchQuery) : searchQuery;
  const paletteRepos = groupFilter ? repos.filter((repo) => repo.groups.some((group) => group.id === groupFilter.id)) : repos;
  const rawScopedRepo = repos.find((repo) => repo.id === scopedRepoId) ?? null;
  const scopedRepo =
    rawScopedRepo && (!groupFilter || rawScopedRepo.groups.some((group) => group.id === groupFilter.id)) ? rawScopedRepo : null;
  const selectedRepo = scopedRepo ?? paletteRepos.find((repo) => repo.id === selectedRepoId) ?? paletteRepos[0] ?? null;
  const localRepoIds = useMemo(() => repos.filter((repo) => repo.localPath).map((repo) => repo.id), [repos]);

  const { data: files = [] } = useQuery({
    queryKey: ["paletteFiles", selectedRepo?.id],
    queryFn: () => window.fallback.repos.listFiles(selectedRepo!.id),
    enabled: Boolean(selectedRepo)
  });
  const { data: fileResults = [] } = useQuery({
    queryKey: ["paletteFileSearch", paletteRepos.map((repo) => repo.id).join(","), scopedRepoId, paletteQuery],
    queryFn: () => searchPaletteFiles(paletteRepos, scopedRepoId, paletteQuery),
    enabled: Boolean(currentView.id === "root" && paletteQuery.length >= 2 && mode === "root" && paletteRepos.length > 0),
    staleTime: 30_000
  });
  const { data: results = [] } = useQuery({
    queryKey: ["palette", paletteQuery, scopedRepoId, groupFilter?.id],
    queryFn: () => window.fallback.search.query(paletteQuery, scopedRepoId ? { repoId: scopedRepoId } : undefined),
    enabled: Boolean(currentView.id === "root" && paletteQuery.length >= 2 && mode === "root")
  });
  const { data: commitResults = null } = useQuery({
    queryKey: ["paletteCommitSearch", selectedRepo?.id, parseCommitSearchQuery(paletteQuery)],
    queryFn: ({ signal }) => searchCommitsWithCancellation(selectedRepo!.id, { ...parseCommitSearchQuery(paletteQuery), limit: 8 }, signal),
    enabled: Boolean(currentView.id === "root" && paletteQuery.length >= 2 && mode === "commit" && selectedRepo),
    staleTime: 10_000
  });
  const { data: rootCommitResults = null } = useQuery({
    queryKey: ["paletteRootCommitSearch", selectedRepo?.id, paletteQuery],
    queryFn: ({ signal }) => searchCommitsWithCancellation(selectedRepo!.id, { message: paletteQuery, limit: 4 }, signal),
    enabled: Boolean(currentView.id === "root" && paletteQuery.length >= 3 && mode === "root" && selectedRepo),
    staleTime: 10_000
  });
  const { data: recentOperations = [] } = useQuery({
    queryKey: ["paletteRecentOperations", selectedRepo?.id],
    queryFn: () => window.fallback.operations.listRecent(selectedRepo?.id),
    enabled: currentView.id === "root",
    staleTime: 10_000
  });
  const { data: recentComments = [] } = useQuery({
    queryKey: ["paletteRecentComments", selectedRepo?.id],
    queryFn: () => window.fallback.comments.listRecent(selectedRepo!.id),
    enabled: Boolean(currentView.id === "root" && selectedRepo),
    staleTime: 30_000
  });
  const { data: localChangesSummaries = [] } = useQuery({
    queryKey: ["localChangesSummary", localRepoIds.join("|")],
    queryFn: () => window.fallback.repos.localChangesSummary(localRepoIds, { includeStats: false }),
    enabled: localRepoIds.length > 0,
    staleTime: 15_000
  });
  const { data: availableRepos = [] } = useQuery({
    queryKey: ["availableRepos"],
    queryFn: window.fallback.repos.listAvailable,
    enabled: currentView.id === "add-repo",
    staleTime: 10 * 60_000
  });
  const { data: windowContexts = [] } = useQuery({
    queryKey: ["windowContexts"],
    queryFn: window.fallback.window.listContexts,
    enabled: currentView.id === "root",
    staleTime: 2000
  });

  useEffect(() => inputRef.current?.focus(), [focusInputRequest]);
  useEffect(
    () => () => {
      if (shortcutTimeoutRef.current != null) window.clearTimeout(shortcutTimeoutRef.current);
    },
    []
  );

  const closeAndSetView = useCallback(
    (view: AppView, repoId?: string | null) => {
      if (repoId !== undefined) setSelectedRepoId(repoId);
      setView(view);
      onClose();
    },
    [onClose, setSelectedRepoId, setView]
  );
  const pushView = useCallback((view: PaletteView) => {
    setViewStack((stack) => [...stack, view]);
    setQuery("");
    setFocusInputRequest((value) => value + 1);
  }, []);
  const popView = () => {
    if (viewStack.length === 1) return;
    setViewStack((stack) => stack.slice(0, -1));
    setQuery("");
    setFocusInputRequest((value) => value + 1);
  };
  const invalidateWorkQueries = useCallback((repoId?: string | null) => invalidateRepoWorkFreshness(queryClient, repoId), [queryClient]);
  const runAsync = useCallback(
    async (label: string, task: () => Promise<unknown>, repoId?: string | null) => {
      await task();
      await invalidateWorkQueries(repoId);
      toast.success(label);
    },
    [invalidateWorkQueries]
  );

  const coreActions = useMemo(
    () =>
      buildCoreActionCatalog({
        repos,
        selectedRepo,
        activeView,
        keybindings: commandPaletteKeybindings,
        windowContexts,
        localChangesSummaries,
        closeAndSetView,
        setMyWorkLane,
        pushView,
        runAsync
      }),
    [
      activeView,
      closeAndSetView,
      localChangesSummaries,
      pushView,
      repos,
      runAsync,
      selectedRepo,
      setMyWorkLane,
      commandPaletteKeybindings,
      windowContexts
    ]
  );
  const currentRepoActions = useMemo(
    () =>
      selectedRepo
        ? buildCurrentRepoActionCatalog({
            repo: selectedRepo,
            summary: localChangesSummaries.find((summary) => summary.repoId === selectedRepo.id) ?? null,
            closeAndSetView,
            pushView,
            runAsync
          })
        : [],
    [closeAndSetView, localChangesSummaries, pushView, runAsync, selectedRepo]
  );
  const repoItems = useMemo(
    () =>
      paletteRepos.map((repo) =>
        repoItem(repo, {
          selected: repo.id === selectedRepoId,
          scoped: repo.id === scopedRepoId,
          keepOpen: mode === "repo-picker",
          run: () => {
            if (mode === "repo-picker") {
              setScopedRepoId(repo.id);
              setQuery("");
              setFocusInputRequest((value) => value + 1);
              return;
            }
            closeAndSetView("Code", repo.id);
          }
        })
      ),
    [closeAndSetView, mode, paletteRepos, scopedRepoId, selectedRepoId]
  );
  const fileItems = useMemo(
    () =>
      fileResults.map((result) =>
        fileItem(result.repo, result.file, () => {
          onOpenFile(result.repo.id, result.file.path);
          onClose();
        })
      ),
    [fileResults, onClose, onOpenFile]
  );
  const entityItems = useMemo(
    () =>
      results
        .filter(
          (result) =>
            (result.entityType === "pull_request" || result.entityType === "issue" || result.entityType === "repo") &&
            (!groupFilter || paletteRepos.some((repo) => repo.id === result.repoId))
        )
        .map((result) => searchResultItem(result, () => onOpenResult(result))),
    [groupFilter, onOpenResult, paletteRepos, results]
  );
  const entityWindowItems = useMemo(
    () =>
      results
        .filter(
          (result) =>
            (result.entityType === "pull_request" || result.entityType === "issue" || result.entityType === "repo") &&
            (!groupFilter || paletteRepos.some((repo) => repo.id === result.repoId))
        )
        .map(searchResultWindowItem),
    [groupFilter, paletteRepos, results]
  );
  const operationItems = useMemo(() => recentOperations.map(operationItem), [recentOperations]);
  const commitItems = useMemo(
    () => (rootCommitResults?.commits ?? []).map((commit) => commitItem(commit, () => onOpenCommit(commit.repoId, commit.sha))),
    [onOpenCommit, rootCommitResults]
  );
  const commitWindowItems = useMemo(() => (rootCommitResults?.commits ?? []).map(commitWindowItem), [rootCommitResults]);
  const commentItems = useMemo(
    () =>
      selectedRepo
        ? recentComments.slice(0, 4).map((comment) =>
            commentItem(comment, selectedRepo, () => {
              const result: SearchResult = {
                entityId: comment.id,
                repoId: selectedRepo.id,
                repoFullName: selectedRepo.fullName,
                entityType: comment.entityType === "issue" ? "issue" : "pull_request",
                entityNumber: comment.entityNumber,
                title: comment.body,
                snippet: comment.body,
                authorLogin: comment.authorLogin,
                state: null,
                updatedAt: comment.updatedAt ?? comment.createdAt
              };
              onOpenResult(result);
            })
          )
        : [],
    [onOpenResult, recentComments, selectedRepo]
  );
  const dirtyRepoItems = useMemo(
    () =>
      localChangesSummaries
        .filter((summary) => summary.isDirty || summary.error)
        .map((summary) => {
          const repo = repos.find((item) => item.id === summary.repoId);
          return repo ? localChangesItem(repo, summary, () => closeAndSetView("Local Changes", repo.id)) : null;
        })
        .filter(Boolean) as CommandPaletteItem[],
    [closeAndSetView, localChangesSummaries, repos]
  );
  const recentRepoItems = useMemo(
    () =>
      recentRepoIds
        .map((repoId) => repos.find((repo) => repo.id === repoId) ?? null)
        .filter((repo): repo is WatchedRepo => Boolean(repo && repo.id !== selectedRepo?.id))
        .slice(0, 3)
        .map((repo) =>
          repoItem(repo, {
            selected: false,
            scoped: repo.id === scopedRepoId,
            run: () => closeAndSetView("Code", repo.id)
          })
        ),
    [closeAndSetView, recentRepoIds, repos, scopedRepoId, selectedRepo?.id]
  );

  const groups = useMemo(() => {
    if (currentView.id === "add-repo") return buildAddRepoGroups(availableRepos, repos, paletteQuery, runAsync, closeAndSetView);
    if (currentView.id === "open" && selectedRepo) return filterGroups([openSubmenuGroup(selectedRepo)], paletteQuery, 8);
    if (currentView.id === "sync") return filterGroups([buildSyncSubmenuCatalog(selectedRepo, runAsync)], paletteQuery, 8);
    if (currentView.id === "local-changes") {
      return filterGroups([buildLocalChangesSubmenuCatalog(selectedRepo, currentRepoActions, runAsync)], paletteQuery, 8);
    }
    if (mode === "repo-picker") {
      return [
        {
          value: "repos",
          label: groupFilter ? `Watched Repositories in ${groupFilter.name}` : "Watched Repositories",
          items: filterAndRankItems(repoItems, paletteQuery, 12)
        }
      ];
    }
    if (mode === "action") {
      return [{ value: "actions", label: "Actions", items: filterAndRankItems([...currentRepoActions, ...coreActions], paletteQuery, 14) }];
    }
    if (mode === "commit") {
      return [
        {
          value: "commits",
          label: selectedRepo ? `Commits in ${selectedRepo.fullName}` : "Commits",
          items: (commitResults?.commits ?? []).flatMap((commit) => [
            commitItem(commit, () => onOpenCommit(commit.repoId, commit.sha)),
            commitWindowItem(commit)
          ])
        }
      ].filter((group) => group.items.length > 0);
    }
    if (paletteQuery) {
      return [
        {
          value: "results",
          label: scopedRepo ? `Results in ${scopedRepo.fullName}` : groupFilter ? `Results in ${groupFilter.name}` : "Results",
          items: filterAndRankItems(
            [
              ...currentRepoActions,
              ...coreActions,
              ...repoItems,
              ...commitItems,
              ...commitWindowItems,
              ...fileItems,
              ...entityItems,
              ...entityWindowItems,
              ...operationItems
            ],
            paletteQuery,
            14
          )
        }
      ];
    }
    return [
      selectedRepo ? { value: "current-repo", label: "Current Repo", items: currentRepoActions.slice(0, 7) } : null,
      { value: "actions", label: "Actions", items: coreActions.slice(0, 9) },
      {
        value: "recent-work",
        label: "Recent Work",
        items: [...recentRepoItems, ...dirtyRepoItems, ...operationItems, ...commentItems].slice(0, 8)
      },
      {
        value: "files",
        label: selectedRepo ? `Files in ${selectedRepo.name}` : "Files",
        items: files
          .filter((file) => file.type === "file")
          .slice(0, 4)
          .map((file) => fileItem(selectedRepo!, file, () => onOpenFile(selectedRepo!.id, file.path)))
      }
    ].filter((group): group is CommandPaletteGroup => Boolean(group && group.items.length > 0));
  }, [
    availableRepos,
    commentItems,
    commitResults,
    commitItems,
    commitWindowItems,
    coreActions,
    currentRepoActions,
    currentView.id,
    dirtyRepoItems,
    entityItems,
    entityWindowItems,
    fileItems,
    files,
    groupFilter,
    mode,
    onOpenCommit,
    onOpenFile,
    operationItems,
    paletteQuery,
    recentRepoItems,
    repoItems,
    repos,
    closeAndSetView,
    runAsync,
    scopedRepo,
    selectedRepo
  ]);

  const runItem = async (item: CommandPaletteItem) => {
    if (item.disabled) {
      if (typeof item.disabled === "string") toast.info(item.disabled);
      return;
    }
    if (!item.run) return;
    try {
      const result = item.run();
      if (result instanceof Promise) {
        setRunningValue(item.value);
        await result;
      }
      if (!item.keepOpen) onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRunningValue(null);
    }
  };
  const scheduleShortcutReset = () => {
    if (shortcutTimeoutRef.current != null) window.clearTimeout(shortcutTimeoutRef.current);
    shortcutTimeoutRef.current = window.setTimeout(() => setShortcutKeys([]), 1200);
  };
  const handleShortcutKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (query || currentView.id !== "root") return false;

    const resolution = resolveShortcutChord(flattenGroups(groups), shortcutKeys, event.nativeEvent);
    if (!resolution.item && resolution.pendingKeys.length === 0) {
      setShortcutKeys([]);
      return false;
    }

    event.preventDefault();
    if (resolution.item) {
      setShortcutKeys([]);
      void runItem(resolution.item);
      return true;
    }

    setShortcutKeys(resolution.pendingKeys);
    scheduleShortcutReset();
    return true;
  };
  const emptyMessage =
    mode === "repo-picker"
      ? "No watched repos match that scope."
      : mode === "commit"
        ? (commitResults?.message ?? "No matching commits.")
        : "No matching commands, repos, files, pull requests, or issues.";
  const platformKey = isMac() ? "⌘K" : "Ctrl K";

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <Command shouldFilter={false} className="palette h-auto" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input-row flex h-[58px] items-center gap-2 border-b border-border px-3">
          {viewStack.length > 1 && (
            <button
              type="button"
              onClick={popView}
              aria-label="Back"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <CommandInput
            ref={inputRef}
            aria-label="Search commands, repos, files, commits, pull requests, and issues"
            value={query}
            onValueChange={setQuery}
            onKeyDown={(event) => {
              if (handleShortcutKey(event)) return;
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
              if (event.key === "Backspace" && !query && viewStack.length > 1) {
                event.preventDefault();
                popView();
              }
            }}
            placeholder={placeholderFor(currentView, mode, scopedRepo, selectedRepo, groupFilter as RepoGroup | null)}
            className="min-w-0 flex-1 text-[16px] text-foreground placeholder:text-muted-foreground"
          />
          {scopedRepo && currentView.id === "root" && mode !== "repo-picker" && (
            <button
              type="button"
              onClick={() => setScopedRepoId(null)}
              className="inline-flex max-w-[190px] items-center gap-1.5 rounded-[6px] border border-border bg-secondary px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
              title="Clear repo scope"
            >
              <span className="truncate">@{scopedRepo.fullName}</span>
              <X className="h-3 w-3 shrink-0" />
            </button>
          )}
        </div>

        <CommandPaletteResults groups={groups} emptyMessage={emptyMessage} runningValue={runningValue} onRun={runItem} />

        <div className="palette-footer flex min-h-[44px] items-center justify-between gap-3 border-t border-border px-4 py-2 text-[12px] text-muted-foreground">
          <div className="flex min-w-0 items-center gap-2">
            {currentView.id === "root" ? <GitHubSearchIcon className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            <span className="truncate">{currentView.id === "root" ? "Fallback Command Palette" : currentView.title}</span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-1">
            <FooterHint keys={["↑", "↓"]} label="Navigate" />
            <FooterHint keys={["↵"]} label="Select" />
            {viewStack.length > 1 && <FooterHint keys={["⌫"]} label="Back" />}
            <FooterHint keys={["Esc"]} label="Close" />
            <FooterHint keys={[platformKey]} label="Toggle" />
          </div>
        </div>
      </Command>
    </div>
  );
}

function buildAddRepoGroups(
  availableRepos: GitHubRepoSummary[],
  watchedRepos: WatchedRepo[],
  query: string,
  runAsync: (label: string, task: () => Promise<unknown>, repoId?: string | null) => Promise<void>,
  closeAndSetView: (view: AppView, repoId?: string | null) => void
): CommandPaletteGroup[] {
  const watchedNames = new Set(watchedRepos.map((repo) => repo.fullName.toLowerCase()));
  const manual = query.includes("/") ? [manualRepoItem(query, runAsync, closeAndSetView)] : [];
  const availableItems = filterAndRankItems(
    availableRepos
      .filter((repo) => !watchedNames.has(repo.fullName.toLowerCase()))
      .map((repo) => availableRepoItem(repo, runAsync, closeAndSetView)),
    query,
    10
  );
  return [{ value: "add-repo", label: "Repositories", items: [...manual, ...availableItems] }].filter((group) => group.items.length > 0);
}

function openSubmenuGroup(repo: WatchedRepo): CommandPaletteGroup {
  return {
    value: "open",
    label: repo.fullName,
    items: [
      actionItem(
        "open-fallback-window",
        "Open repo in new Fallback window",
        repo.fullName,
        <ExternalLink className="h-4 w-4" />,
        [],
        async () => {
          await window.fallback.window.openContext({ repoId: repo.id, view: "Code" });
        },
        undefined,
        true
      ),
      actionItem(
        "open-folder",
        "Open local folder",
        repo.localPath ?? "Repository is metadata-only",
        <FolderOpen className="h-4 w-4" />,
        [],
        () => {
          if (repo.localPath) return window.fallback.shell.openPath(repo.localPath);
        },
        repo.localPath ? undefined : "No local folder"
      ),
      actionItem(
        "open-editor",
        "Open in editor",
        repo.localPath ?? "Repository is metadata-only",
        <GitHubCodeIcon className="h-4 w-4" />,
        [],
        () => {
          if (repo.localPath) return window.fallback.shell.openEditor(repo.localPath);
        },
        repo.localPath ? undefined : "No local folder"
      ),
      actionItem(
        "open-terminal",
        "Open in terminal",
        repo.localPath ?? "Repository is metadata-only",
        <Terminal className="h-4 w-4" />,
        [],
        () => {
          if (repo.localPath) return window.fallback.shell.openTerminal(repo.localPath);
        },
        repo.localPath ? undefined : "No local folder"
      ),
      actionItem(
        "reveal-folder",
        "Reveal local folder",
        repo.localPath ?? "Repository is metadata-only",
        <FolderOpen className="h-4 w-4" />,
        [],
        () => {
          if (repo.localPath) return window.fallback.shell.revealPath(repo.localPath);
        },
        repo.localPath ? undefined : "No local folder"
      ),
      actionItem(
        "open-github",
        "Open repo on GitHub",
        repo.htmlUrl ?? "No GitHub URL cached",
        <MarkGithubIcon className="h-4 w-4" />,
        [],
        () => {
          if (repo.htmlUrl) return window.fallback.shell.openExternal(repo.htmlUrl);
        },
        repo.htmlUrl ? undefined : "No GitHub URL"
      ),
      actionItem(
        "open-pulls",
        "Open repo pull requests on GitHub",
        `${repo.fullName}/pulls`,
        <GitHubPullRequestIcon className="h-4 w-4" />,
        [],
        () => {
          if (repo.htmlUrl) return window.fallback.shell.openExternal(`${repo.htmlUrl}/pulls`);
        },
        repo.htmlUrl ? undefined : "No GitHub URL"
      ),
      actionItem(
        "open-issues",
        "Open repo issues on GitHub",
        `${repo.fullName}/issues`,
        <GitHubIssueOpenedIcon className="h-4 w-4" />,
        [],
        () => {
          if (repo.htmlUrl) return window.fallback.shell.openExternal(`${repo.htmlUrl}/issues`);
        },
        repo.htmlUrl ? undefined : "No GitHub URL"
      )
    ]
  };
}

function actionItem(
  id: string,
  title: string,
  description: string,
  icon: React.ReactNode,
  shortcut: string[],
  run: () => void | Promise<void>,
  disabled?: string,
  keepOpen = false,
  trailingContent?: React.ReactNode
): CommandPaletteItem {
  return commandActionItem({
    id,
    title,
    description,
    shortcut,
    leadingContent: icon,
    trailingContent,
    disabled,
    keepOpen,
    run
  });
}

function repoItem(
  repo: WatchedRepo,
  options: { selected: boolean; scoped: boolean; keepOpen?: boolean; run: () => void }
): CommandPaletteItem {
  return {
    kind: "repo",
    value: `repo:${repo.id}`,
    title: repo.fullName,
    description: [repo.defaultBranch, repo.language, syncStatusLabel(repo.syncStatus)].filter(Boolean).join(" · "),
    timestamp: repo.githubUpdatedAt ?? repo.pushedAt ?? repo.lastSuccessfulSyncAt,
    searchTerms: [repo.fullName, repo.owner, repo.name, ...(repo.groups ?? []).map((group) => group.name)],
    leadingContent: <GitHubRepoIcon className="h-4 w-4" />,
    trailingContent: options.scoped || options.selected ? <GitHubCheckIcon className="h-4 w-4" /> : syncBadge(repo.syncStatus),
    keepOpen: options.keepOpen,
    payload: { type: "repo", repo },
    run: options.run
  };
}

function fileItem(repo: WatchedRepo, file: RepoFileEntry, run: () => void): CommandPaletteItem {
  return {
    kind: "file",
    value: `file:${repo.id}:${file.path}`,
    title: file.name,
    description: `${repo.fullName} · ${file.path}`,
    searchTerms: [file.name, file.path, repo.fullName],
    timestamp: file.cachedAt,
    leadingContent: <GitHubFileIcon className="h-4 w-4" />,
    payload: { type: "file", repo, file },
    run
  };
}

function commitItem(commit: CommitSearchHit, run: () => void): CommandPaletteItem {
  return {
    kind: "commit",
    value: `commit:${commit.repoId}:${commit.sha}`,
    title: commit.message.split("\n")[0] || shortSha(commit.sha),
    description: `${commit.repoFullName} · ${shortSha(commit.sha)}${commit.authorName ? ` · ${commit.authorName}` : ""}`,
    timestamp: commit.committedAt,
    searchTerms: [commit.message, commit.sha, shortSha(commit.sha), commit.authorLogin ?? "", commit.authorName ?? "", commit.repoFullName],
    leadingContent: <GitHubCommitIcon className="h-4 w-4" />,
    trailingContent: <span className="font-mono">{shortSha(commit.sha)}</span>,
    payload: { type: "commit", commit },
    run
  };
}

function commitWindowItem(commit: CommitSearchHit): CommandPaletteItem {
  return actionItem(
    `commit-new-window-${commit.repoId}-${commit.sha}`,
    "Open commit in new window",
    `${commit.repoFullName} · ${shortSha(commit.sha)}`,
    <ExternalLink className="h-4 w-4" />,
    [],
    async () => {
      await window.fallback.window.openContext({
        repoId: commit.repoId,
        view: "Code",
        selectedEntityId: `commit:${commit.sha}`
      });
    },
    undefined,
    true,
    <span className="font-mono">{shortSha(commit.sha)}</span>
  );
}

function searchResultItem(result: SearchResult, run: () => void): CommandPaletteItem {
  const isPr = result.entityType === "pull_request";
  const kind = result.entityType === "issue" ? "issue" : isPr ? "pull_request" : "repo";
  return {
    kind,
    value: `${result.entityType}:${result.repoId}:${result.entityId}`,
    title: result.title ?? result.snippet ?? result.repoFullName,
    description: `${result.repoFullName}${result.entityNumber ? ` #${result.entityNumber}` : ""}${result.state ? ` · ${result.state}` : ""}`,
    timestamp: result.updatedAt,
    searchTerms: [
      result.repoFullName,
      result.title ?? "",
      result.snippet ?? "",
      String(result.entityNumber ?? ""),
      result.authorLogin ?? ""
    ],
    leadingContent: isPr ? (
      <GitHubPullRequestIcon className="h-4 w-4" />
    ) : result.entityType === "issue" ? (
      <GitHubIssueOpenedIcon className="h-4 w-4" />
    ) : (
      <GitHubRepoIcon className="h-4 w-4" />
    ),
    trailingContent: result.entityNumber ? <span className="font-mono">#{result.entityNumber}</span> : undefined,
    payload: { type: "result", result },
    run
  };
}

function searchResultWindowItem(result: SearchResult): CommandPaletteItem {
  const entityKind = result.entityType === "pull_request" ? "PR" : result.entityType === "issue" ? "issue" : "repo";
  const view = result.entityType === "pull_request" ? "Pull requests" : result.entityType === "issue" ? "Issues" : "Code";
  const selectedEntityId =
    result.entityType === "pull_request"
      ? `pr:${result.entityNumber ?? result.entityId}`
      : result.entityType === "issue"
        ? `issue:${result.entityNumber ?? result.entityId}`
        : null;
  return actionItem(
    `${result.entityType}-new-window-${result.repoId}-${result.entityId}`,
    `Open ${entityKind} in new window`,
    `${result.repoFullName}${result.entityNumber ? ` #${result.entityNumber}` : ""}`,
    <ExternalLink className="h-4 w-4" />,
    [],
    async () => {
      await window.fallback.window.openContext({
        repoId: result.repoId,
        view,
        selectedEntityId
      });
    },
    undefined,
    true,
    result.entityNumber ? <span className="font-mono">#{result.entityNumber}</span> : undefined
  );
}

function operationItem(operation: OperationRecord): CommandPaletteItem {
  const view = operationView(operation);
  return {
    kind: "operation",
    value: `operation:${operation.id}`,
    title: operation.commandSummary ?? operation.kind,
    description: [operation.repoFullName, operation.status, operation.resultSummary ?? operation.errorMessage].filter(Boolean).join(" · "),
    timestamp: operation.completedAt ?? operation.startedAt ?? operation.createdAt,
    searchTerms: [
      operation.kind,
      operation.commandSummary ?? "",
      operation.redactedCommand ?? "",
      operation.repoFullName ?? "",
      operation.status
    ],
    leadingContent:
      operation.status === "running" || operation.status === "queued" ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <GitHubWorkflowIcon className="h-4 w-4" />
      ),
    trailingContent: <StatusPill status={operation.status} />,
    payload: { type: "operation", operation },
    run: async () => {
      await window.fallback.window.openContext({
        repoId: operation.repoId,
        workspaceId: operation.workspaceId,
        view,
        selectedEntityId: `operation:${operation.id}`
      });
    }
  };
}

function operationView(operation: OperationRecord): AppView {
  if (/^(fetch_branch|pull_branch|push_branch|publish_branch)$/.test(operation.kind)) return "Code";
  if (operation.repoId) return "Local Changes";
  return "Status";
}

function commentItem(comment: TimelineComment, repo: WatchedRepo, run: () => void): CommandPaletteItem {
  return {
    kind: comment.entityType === "issue" ? "issue" : "pull_request",
    value: `comment:${comment.id}`,
    title: comment.body?.replace(/\s+/g, " ").trim() || "Recent comment",
    description: `${repo.fullName} #${comment.entityNumber}${comment.authorLogin ? ` · ${comment.authorLogin}` : ""}`,
    timestamp: comment.updatedAt ?? comment.createdAt,
    searchTerms: [comment.body ?? "", comment.authorLogin ?? "", repo.fullName, String(comment.entityNumber)],
    leadingContent: <GitHubCommentIcon className="h-4 w-4" />,
    payload: { type: "comment", comment, repo },
    run
  };
}

function localChangesItem(repo: WatchedRepo, summary: LocalChangesSummary, run: () => void): CommandPaletteItem {
  return {
    kind: "operation",
    value: `local-changes:${repo.id}`,
    title: repo.fullName,
    description: summary.error ?? `${localChangesSummaryLabel(summary)} on ${summary.branch ?? "current branch"}`,
    searchTerms: [repo.fullName, repo.name, repo.owner, summary.branch ?? "", "dirty local changes"],
    leadingContent: <RotateCcw className="h-4 w-4" />,
    trailingContent: dirtyBadge(summary),
    payload: { type: "local-changes", summary, repo },
    run
  };
}

function availableRepoItem(
  repo: GitHubRepoSummary,
  runAsync: (label: string, task: () => Promise<unknown>, repoId?: string | null) => Promise<void>,
  closeAndSetView: (view: AppView, repoId?: string | null) => void
): CommandPaletteItem {
  return {
    kind: "repo",
    value: `available-repo:${repo.fullName}`,
    title: repo.fullName,
    description: repo.description ?? [repo.defaultBranch, repo.visibility].filter(Boolean).join(" · "),
    timestamp: repo.githubUpdatedAt ?? repo.pushedAt,
    searchTerms: [repo.fullName, repo.owner, repo.name, repo.description ?? ""],
    leadingContent: <GitHubRepoIcon className="h-4 w-4" />,
    payload: { type: "available-repo", repo },
    run: async () => {
      const watched = (await window.fallback.repos.watch({ fullName: repo.fullName })) as WatchedRepo;
      await runAsync(`${watched.fullName} is watched.`, () => Promise.resolve(watched), watched.id);
      closeAndSetView("Code", watched.id);
    }
  };
}

function manualRepoItem(
  fullName: string,
  runAsync: (label: string, task: () => Promise<unknown>, repoId?: string | null) => Promise<void>,
  closeAndSetView: (view: AppView, repoId?: string | null) => void
): CommandPaletteItem {
  const normalized = fullName.trim();
  return {
    kind: "action",
    value: `manual-repo:${normalized}`,
    title: `Watch ${normalized}`,
    description: "Add by owner/name",
    searchTerms: [normalized, "watch repository add repo"],
    leadingContent: <Plus className="h-4 w-4" />,
    payload: { type: "manual-repo", fullName: normalized },
    run: async () => {
      const repo = (await window.fallback.repos.watch({ fullName: normalized })) as WatchedRepo;
      await runAsync(`${repo.fullName} is watched.`, () => Promise.resolve(repo), repo.id);
      closeAndSetView("Code", repo.id);
    }
  };
}

async function searchPaletteFiles(repos: WatchedRepo[], scopedRepoId: string | null, query: string): Promise<PaletteFileResult[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const targets = (scopedRepoId ? repos.filter((repo) => repo.id === scopedRepoId) : repos).slice(0, scopedRepoId ? 1 : 10);
  const results: PaletteFileResult[] = [];
  for (const repo of targets) {
    await collectPaletteFiles(repo, "", needle, results, scopedRepoId ? 40 : 12, scopedRepoId ? 3 : 2);
    if (results.length >= 50) break;
  }
  return results
    .sort((a, b) => fileSearchScore(a, needle) - fileSearchScore(b, needle) || a.file.path.localeCompare(b.file.path))
    .slice(0, 50);
}

async function collectPaletteFiles(
  repo: WatchedRepo,
  dirPath: string,
  needle: string,
  results: PaletteFileResult[],
  maxPerRepo: number,
  maxDepth: number
): Promise<void> {
  const repoResultCount = () => results.filter((result) => result.repo.id === repo.id).length;
  if (repoResultCount() >= maxPerRepo) return;
  const entries = await window.fallback.repos.listFiles(repo.id, dirPath).catch(() => []);
  for (const entry of entries) {
    if (entry.type !== "file") continue;
    const haystack = `${repo.fullName}/${entry.path}`.toLowerCase();
    if (haystack.includes(needle)) {
      results.push({ repo, file: entry });
      if (repoResultCount() >= maxPerRepo) return;
    }
  }
  const depth = dirPath ? dirPath.split("/").length : 0;
  if (depth >= maxDepth) return;
  const dirs = entries
    .filter((entry) => entry.type === "dir" && !ignoredPaletteDir(entry.name))
    .sort(sortRepoFiles)
    .slice(0, 24);
  for (const dir of dirs) {
    await collectPaletteFiles(repo, dir.path, needle, results, maxPerRepo, maxDepth);
    if (repoResultCount() >= maxPerRepo || results.length >= 50) return;
  }
}

function ignoredPaletteDir(name: string): boolean {
  return new Set([".git", "node_modules", "dist", "build", "coverage", ".next", "vendor", "target", "release", ".turbo"]).has(name);
}

function fileSearchScore(result: PaletteFileResult, needle: string): number {
  const path = result.file.path.toLowerCase();
  const name = result.file.name.toLowerCase();
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (path.startsWith(needle)) return 2;
  if (path.includes(`/${needle}`)) return 3;
  return 4;
}

function placeholderFor(
  view: PaletteView,
  mode: string,
  scopedRepo: WatchedRepo | null,
  selectedRepo: WatchedRepo | null,
  groupFilter: RepoGroup | null
): string {
  if (view.id === "add-repo") return "Paste owner/name or search available repositories...";
  if (view.id !== "root") return `Filter ${view.title.toLowerCase()} actions...`;
  if (mode === "repo-picker") return "Filter watched repositories...";
  if (mode === "action") return "Filter actions...";
  if (mode === "commit") return selectedRepo ? `Search commits in ${selectedRepo.name}...` : "Search commits...";
  if (groupFilter) return `Search repos and work in group ${groupFilter.name}...`;
  if (scopedRepo) return `Search actions, files, commits, PRs, and issues in ${scopedRepo.name}...`;
  return "Search actions, repos, files, commits, PRs, and issues...";
}

function syncStatusLabel(status: WatchedRepo["syncStatus"]): string {
  if (status === "fresh") return "Synced";
  return status.replace("_", " ");
}

function syncBadge(status: WatchedRepo["syncStatus"]) {
  return <StatusPill status={syncStatusLabel(status)} />;
}

function dirtyBadge(summary: LocalChangesSummary | null | undefined) {
  if (!summary?.isDirty) return null;
  if (summary.additions === 0 && summary.deletions === 0) {
    return (
      <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]">{compactCount(summary.fileCount)} files</span>
    );
  }
  return (
    <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]">
      +{compactCount(summary.additions)} -{compactCount(summary.deletions)}
    </span>
  );
}

function localChangesSummaryLabel(summary: LocalChangesSummary): string {
  const fileLabel = `${compactCount(summary.fileCount)} ${summary.fileCount === 1 ? "file" : "files"}`;
  if (summary.additions === 0 && summary.deletions === 0) return fileLabel;
  return `${fileLabel}, +${compactCount(summary.additions)} -${compactCount(summary.deletions)}`;
}

function StatusPill({ status }: { status: string }) {
  return <span className="rounded border border-border px-1.5 py-0.5 text-[10px] capitalize">{status.replace("_", " ")}</span>;
}

function FooterHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {keys.map((key) => (
        <KeyCap key={key}>{key}</KeyCap>
      ))}
      <span>{label}</span>
    </span>
  );
}

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
