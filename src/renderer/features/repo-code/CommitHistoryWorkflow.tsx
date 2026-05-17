import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, GitBranch, RotateCcw, SearchCheck } from "lucide-react";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type { CommitSearchInput as CommitSearchInputModel, CommitSearchResult, RepoCommitSummary } from "../../../shared/domain/repo-code";
import { parseCommitSearchQuery } from "../../../shared/commit-history-search";
import { Avatar } from "../../components/Avatar";
import { CacheTimestamp } from "../../components/CacheTimestamp";
import { Button as UiButton, SearchField } from "../../components/ui";
import { ButtonGroup } from "../../components/ui/button-group";
import { RevertCommitDialog } from "./RevertCommitDialog";
import { CommitGraphPanel } from "./CommitGraphPanel";
import { searchCommitsWithCancellation } from "./commit-search";
import { formatRelative, revertCommitSummary, shortSha } from "../../lib/format";
import type { CommitOpenTarget } from "./RepoCodeView";
import {
  applyCommitQuerySuggestion,
  buildCommitFilterSuggestions,
  commitGraphNodeMatches,
  commitGraphNodeToListItem,
  commitGraphStatusCopy,
  commitSearchHasFilters,
  commitSearchStatusCopy,
  commitToListItem,
  formatCommitSearchSummary,
  uniqueCommitFilterValues,
  type CommitListItem,
  type CommitQuerySuggestion
} from "./commit-query-language";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function CommitHistoryWorkflow({
  repo,
  commits,
  commitOpenTarget,
  onLocalChangesCreated
}: {
  repo: WatchedRepo;
  commits: RepoCommitSummary[];
  commitOpenTarget: CommitOpenTarget | null;
  onLocalChangesCreated: (summary?: string) => void;
}) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [revertTarget, setRevertTarget] = useState<CommitListItem | null>(null);
  const [searchText, setSearchText] = useState("");
  const [historyMode, setHistoryMode] = useState<"graph" | "list">("list");
  const [selectedGraphSha, setSelectedGraphSha] = useState<string | null>(null);
  const canUseRevertCommit = typeof window.fallback.repos.revertCommit === "function";
  const parsedSearch = useMemo(() => parseCommitSearchQuery(searchText), [searchText]);
  const searchInput = useMemo<CommitSearchInputModel>(
    () => ({
      ...parsedSearch,
      limit: 100
    }),
    [parsedSearch]
  );
  const hasSearch = commitSearchHasFilters(searchInput);
  const searchCommits = useQuery({
    queryKey: ["commitSearch", repo.id, searchInput],
    queryFn: ({ signal }) => searchCommitsWithCancellation(repo.id, searchInput, signal),
    enabled: hasSearch,
    staleTime: 10_000
  });
  const commitGraph = useQuery({
    queryKey: ["commitGraph", repo.id],
    queryFn: () => window.fallback.repos.commitGraph(repo.id, { limit: 300, sinceDays: 90 }),
    enabled: Boolean(repo.id),
    staleTime: 30_000
  });
  const searchResult = searchCommits.data ?? null;
  const graph = commitGraph.data ?? null;
  const visibleCommits: CommitListItem[] = hasSearch ? (searchResult?.commits ?? []) : commits.map(commitToListItem);
  const visibleGraphNodes = useMemo(
    () => (graph?.nodes ?? []).filter((node) => commitGraphNodeMatches(node, searchInput)),
    [graph?.nodes, searchInput]
  );
  const selectedGraphNode = visibleGraphNodes.find((node) => node.sha === selectedGraphSha) ?? visibleGraphNodes[0] ?? null;
  const commitFilterSuggestions = useMemo(() => {
    const commitPool = [...commits.map(commitToListItem), ...(searchResult?.commits ?? [])];
    const graphPool = graph?.nodes ?? [];
    return {
      authors: uniqueCommitFilterValues(
        [
          ...commitPool.flatMap((commit) => [commit.authorLogin, commit.authorName, commit.authorEmail]),
          ...graphPool.flatMap((commit) => [commit.authorName, commit.authorEmail])
        ],
        8
      ),
      refs: uniqueCommitFilterValues([repo.defaultBranch, "main", "master", "develop", ...(graph?.refs.map((ref) => ref.name) ?? [])], 8),
      paths: uniqueCommitFilterValues(
        [...commitPool.map((commit) => commit.matchedPath), ...graphPool.flatMap((commit) => commit.files.map((file) => file.path))],
        8
      ),
      shas: uniqueCommitFilterValues([...commitPool.map((commit) => commit.sha), ...graphPool.map((commit) => commit.sha)], 8).map(shortSha)
    };
  }, [commits, graph?.nodes, graph?.refs, repo.defaultBranch, searchResult?.commits]);
  const revertCommit = useMutation({
    mutationFn: (commit: CommitListItem) => {
      if (!canUseRevertCommit) throw new Error("Restart Fallback to finish loading commit revert support.");
      return window.fallback.repos.revertCommit(repo.id, commit.sha);
    },
    onSuccess: async (_changes, commit) => {
      setRevertTarget(null);
      setNotice(`Revert for ${shortSha(commit.sha)} is ready in Local Changes.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["localChanges", repo.id] }),
        queryClient.invalidateQueries({ queryKey: ["localChangesSummary"] }),
        queryClient.invalidateQueries({ queryKey: ["repoCodeSummary", repo.id] }),
        queryClient.invalidateQueries({ queryKey: ["repoFiles", repo.id] })
      ]);
      onLocalChangesCreated(revertCommitSummary(commit));
    },
    onError: (mutationError) => {
      setRevertTarget(null);
      setNotice(errorMessage(mutationError));
    }
  });

  useEffect(() => {
    if (!commitOpenTarget) return;
    setSearchText(`sha:${commitOpenTarget.sha}`);
    setHistoryMode("graph");
    setSelectedGraphSha(commitOpenTarget.sha);
  }, [commitOpenTarget]);

  useEffect(() => {
    if (selectedGraphSha && visibleGraphNodes.some((node) => node.sha === selectedGraphSha)) return;
    setSelectedGraphSha(visibleGraphNodes[0]?.sha ?? null);
  }, [selectedGraphSha, visibleGraphNodes]);

  return (
    <div className="space-y-3">
      {revertTarget && (
        <RevertCommitDialog
          repoId={repo.id}
          commit={revertTarget}
          pending={revertCommit.isPending}
          onClose={() => setRevertTarget(null)}
          onConfirm={() => revertCommit.mutate(revertTarget)}
        />
      )}
      {notice && (
        <div className="flex items-center justify-between rounded-md border border-neutral-800 bg-[#0A0A0A] px-3 py-2 text-sm text-neutral-300">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-neutral-500 transition-colors hover:text-white">
            Dismiss
          </button>
        </div>
      )}
      <div className="border-b border-border pb-3">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <CommitSearchInput
            value={searchText}
            onChange={setSearchText}
            placeholder="Search or filter"
            ariaLabel="Search or filter commits"
            suggestions={commitFilterSuggestions}
          />
          <ButtonGroup aria-label="Commit history view">
            <UiButton
              type="button"
              variant={historyMode === "list" ? "secondary" : "ghost"}
              size="sm"
              className="h-9 gap-1.5 border border-border bg-background-100 px-2.5"
              onClick={() => setHistoryMode("list")}
              aria-pressed={historyMode === "list"}
            >
              <SearchCheck className="h-3.5 w-3.5" />
              <span>List</span>
            </UiButton>
            <UiButton
              type="button"
              variant={historyMode === "graph" ? "secondary" : "ghost"}
              size="sm"
              className="h-9 gap-1.5 border border-border bg-background-100 px-2.5"
              onClick={() => setHistoryMode("graph")}
              aria-pressed={historyMode === "graph"}
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span>Graph</span>
            </UiButton>
          </ButtonGroup>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {historyMode === "graph"
              ? commitGraphStatusCopy(commitGraph.isFetching, graph, hasSearch, visibleGraphNodes.length)
              : commitSearchStatusCopy(hasSearch, searchCommits.isFetching, searchResult, repo, visibleCommits.length)}
          </span>
          <div className="flex items-center gap-3">
            {historyMode === "graph" && graph && (
              <span>
                {graph.nodes.length} commits · {graph.refs.length} refs · {graph.stashes.length} stashes
              </span>
            )}
            {hasSearch && (
              <button
                type="button"
                onClick={() => setSearchText("")}
                className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {hasSearch && (
          <div className="mt-2 text-xs text-muted-foreground">
            Filters: <span className="font-mono text-neutral-400">{formatCommitSearchSummary(searchInput)}</span>
          </div>
        )}
      </div>
      {historyMode === "graph" && (
        <CommitGraphPanel
          graph={graph}
          fetching={commitGraph.isFetching}
          error={commitGraph.error}
          nodes={visibleGraphNodes}
          selectedNode={selectedGraphNode}
          hasSearch={hasSearch}
          onSelect={(node) => setSelectedGraphSha(node.sha)}
          onCopySha={async (sha) => {
            await navigator.clipboard.writeText(sha);
            setNotice(`Copied ${shortSha(sha)}`);
          }}
          onOpenCommit={(url) => void window.fallback.shell.openExternal(url)}
          onRevertCommit={(node) => {
            if (!repo.localPath) {
              setNotice("Reverting commits requires a cloned repository.");
              return;
            }
            if (!canUseRevertCommit) {
              setNotice("Restart Fallback to finish loading commit revert support.");
              return;
            }
            setRevertTarget(commitGraphNodeToListItem(node, repo));
          }}
        />
      )}
      {historyMode === "list" && searchCommits.error && (
        <div className="rounded-md border border-red-700/30 bg-red-200/35 px-3 py-2 text-sm text-red-900">
          {errorMessage(searchCommits.error)}
        </div>
      )}
      {historyMode === "list" && hasSearch && searchCommits.isFetching && (
        <div className="rounded-lg border border-neutral-800 bg-[#0A0A0A] p-8 text-center text-sm text-neutral-500">
          Searching commits...
        </div>
      )}
      {historyMode === "list" && !searchCommits.isFetching && visibleCommits.length === 0 && (
        <CommitHistoryEmptyState hasSearch={hasSearch} repo={repo} searchResult={searchResult} />
      )}
      {historyMode === "list" && visibleCommits.length > 0 && (
        <div className="overflow-hidden border-y border-neutral-900">
          {visibleCommits.map((commit) => {
            const author = commit.authorLogin ?? commit.authorName ?? "unknown";
            const age = commit.committedAt ? formatRelative(commit.committedAt) : "commit time unknown";
            return (
              <div
                key={commit.sha}
                className="group grid min-h-[76px] grid-cols-1 gap-3 border-b border-neutral-900 px-3 py-4 transition-colors last:border-b-0 hover:bg-[#111111] md:grid-cols-[minmax(0,1fr)_minmax(160px,auto)_minmax(180px,auto)] md:items-start"
              >
                <div className="min-w-0 space-y-1">
                  <div className="truncate font-medium text-neutral-200 transition-colors group-hover:text-white">{commit.message}</div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-neutral-500">
                    <Avatar seed={author} size="sm" />
                    <span className="font-medium text-neutral-400">{author}</span>
                    <span className="whitespace-nowrap">committed {age}</span>
                    {commit.matchedPath && <span className="truncate font-mono text-xs text-neutral-600">{commit.matchedPath}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs md:justify-end">
                  <span className="font-mono text-neutral-500">{shortSha(commit.sha)}</span>
                  {commit.verified && (
                    <span className="rounded border border-green-700/30 bg-green-200/35 px-1.5 py-0.5 text-green-900">Verified</span>
                  )}
                  {commit.source === "cache" && (
                    <CacheTimestamp state="cached" className="rounded border border-neutral-800 bg-black px-1.5 py-0.5" />
                  )}
                  {commit.source === "git" && (
                    <span className="rounded border border-neutral-800 bg-black px-1.5 py-0.5 text-neutral-500">Local git</span>
                  )}
                </div>
                <div className="flex items-center gap-2 md:justify-end">
                  {commit.htmlUrl && (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        void window.fallback.shell.openExternal(commit.htmlUrl!);
                      }}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-neutral-500 transition-colors hover:bg-black hover:text-white focus-visible:bg-black focus-visible:text-white"
                      title="Open commit"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>Open</span>
                    </button>
                  )}
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!repo.localPath) {
                        setNotice("Reverting commits requires a cloned repository.");
                        return;
                      }
                      if (!canUseRevertCommit) {
                        setNotice("Restart Fallback to finish loading commit revert support.");
                        return;
                      }
                      setRevertTarget(commit);
                    }}
                    disabled={revertCommit.isPending}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-neutral-900 px-2 text-xs text-neutral-500 transition-colors hover:border-red-700/30 hover:bg-red-200/35 hover:text-red-900 focus-visible:border-red-700/30 focus-visible:bg-red-200/35 focus-visible:text-red-900 disabled:cursor-not-allowed disabled:opacity-50"
                    title={
                      !repo.localPath
                        ? "Clone this repo to revert commits"
                        : canUseRevertCommit
                          ? "Create local revert"
                          : "Restart Fallback to load commit revert support"
                    }
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>{revertCommit.isPending ? "Reverting" : "Revert"}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CommitSearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  suggestions
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  suggestions: { authors: string[]; refs: string[]; paths: string[]; shas: string[] };
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const querySuggestions = useMemo(() => buildCommitFilterSuggestions(value, suggestions), [suggestions, value]);
  const showMenu = focused && !menuDismissed && querySuggestions.length > 0;
  const applySuggestion = (suggestion: CommitQuerySuggestion) => {
    onChange(applyCommitQuerySuggestion(value, suggestion.value));
    setMenuDismissed(false);
    setFocused(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [querySuggestions.length, value]);

  return (
    <div className="relative min-w-0 flex-1">
      <SearchField
        ref={inputRef}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => {
          setMenuDismissed(false);
          onChange(event.currentTarget.value);
        }}
        onFocus={() => {
          setMenuDismissed(false);
          setFocused(true);
        }}
        onBlur={() =>
          window.setTimeout(() => {
            setFocused(false);
          }, 120)
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setMenuDismissed(true);
            return;
          }
          if (!showMenu || querySuggestions.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveSuggestionIndex((index) => Math.min(index + 1, querySuggestions.length - 1));
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveSuggestionIndex((index) => Math.max(index - 1, 0));
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            applySuggestion(querySuggestions[activeSuggestionIndex] ?? querySuggestions[0]!);
          }
        }}
        type="text"
        placeholder={placeholder}
        density="compact"
      />
      {showMenu && (
        <div className="absolute left-0 top-full z-40 mt-1 w-80 max-w-[calc(100vw-3rem)] overflow-hidden rounded-md border border-neutral-800 bg-[#0A0A0A] shadow-2xl">
          {querySuggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.value}:${suggestion.description}`}
              type="button"
              onMouseEnter={() => setActiveSuggestionIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                applySuggestion(suggestion);
              }}
              className={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-[13px] transition-colors ${
                index === activeSuggestionIndex ? "bg-neutral-900" : "hover:bg-neutral-900"
              }`}
            >
              <span className="min-w-0 truncate font-mono text-neutral-200">{suggestion.value}</span>
              <span className="shrink-0 text-xs text-neutral-600">{suggestion.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CommitHistoryEmptyState({
  hasSearch,
  repo,
  searchResult
}: {
  hasSearch: boolean;
  repo: WatchedRepo;
  searchResult: CommitSearchResult | null;
}) {
  const title = hasSearch ? "No commits found" : "No commits loaded";
  const detail = hasSearch
    ? (searchResult?.message ?? "Try a different author, SHA, message, date, branch, or path filter.")
    : repo.localPath
      ? "Refresh repo metadata or search local history."
      : "Clone this repo or refresh GitHub metadata to populate commit history.";
  return (
    <div className="border border-neutral-800 rounded-lg p-12 bg-[#0A0A0A] text-center">
      <p className="text-neutral-400 text-lg font-medium mb-2">{title}</p>
      <p className="text-neutral-500 text-sm">{detail}</p>
    </div>
  );
}
