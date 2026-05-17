import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { GitHubRepoSummary, WatchedRepo } from "../../shared/domain/watched-repo";
import {
  availableRepoOwners,
  filterAvailableRepos,
  type RepoKindFilter,
  type RepoVisibilityFilter,
  type RepoWatchFilter
} from "../../shared/repo-display";
import { formatRelative } from "../lib/format";
import { Avatar } from "./Avatar";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { BranchIntegrityBadge } from "../features/branch-integrity/BranchIntegrityBadge";
import { Search } from "lucide-react";

export function RepoPicker({
  repos,
  watchedRepos,
  loading,
  query,
  watching,
  onQuery,
  onWatch
}: {
  repos: GitHubRepoSummary[];
  watchedRepos: WatchedRepo[];
  loading: boolean;
  query: string;
  watching: boolean;
  onQuery: (q: string) => void;
  onWatch: (fullName: string) => void;
}) {
  const [owner, setOwner] = useState("all");
  const [visibility, setVisibility] = useState<RepoVisibilityFilter>("all");
  const [watch, setWatch] = useState<RepoWatchFilter>("unwatched");
  const [kind, setKind] = useState<RepoKindFilter>("all");
  const [recentOnly, setRecentOnly] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const watchedNames = useMemo(() => new Set(watchedRepos.map((r) => r.fullName.toLowerCase())), [watchedRepos]);
  const watchedByName = useMemo(() => new Map(watchedRepos.map((repo) => [repo.fullName.toLowerCase(), repo])), [watchedRepos]);
  const { data: branchIntegritySummaries = [] } = useQuery({
    queryKey: ["branchIntegritySummaries", watchedRepos.map((repo) => repo.id).join("|")],
    queryFn: async () => Promise.all(watchedRepos.map((repo) => window.fallback.branchIntegrity.summary(repo.id))),
    enabled: watchedRepos.length > 0,
    staleTime: 30_000
  });
  const branchIntegrityByRepo = useMemo(
    () => new Map(branchIntegritySummaries.map((summary) => [summary.repoId, summary])),
    [branchIntegritySummaries]
  );
  const owners = useMemo(() => availableRepoOwners(repos), [repos]);
  const choices = useMemo(
    () =>
      filterAvailableRepos(repos, watchedRepos, {
        query,
        owner: owner === "all" ? undefined : owner,
        visibility,
        watch,
        kind,
        recentOnly
      }).slice(0, 80),
    [kind, owner, query, recentOnly, repos, visibility, watch, watchedRepos]
  );
  useEffect(() => {
    setActiveIndex(0);
  }, [choices.length, query, owner, visibility, watch, kind, recentOnly]);
  const manualCandidate = query.trim();
  const canWatchManual = /^[^\s/]+\/[^\s/]+$/.test(manualCandidate);
  const manualAlreadyWatched = watchedNames.has(manualCandidate.toLowerCase());
  const manualWatchLabel = manualAlreadyWatched ? "Already watched" : `Watch ${manualCandidate}`;
  const totalFilteredCount = choices.length;
  const selectClassName =
    "h-9 w-full border-gray-alpha-300 bg-background-200 text-[13px] text-gray-900 shadow-none hover:border-gray-alpha-400 focus-visible:border-gray-alpha-600 focus-visible:ring-0";
  const filterLabelClassName = "mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-gray-700";

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <label className="relative block min-w-0">
          <span className="sr-only">Search accessible repositories or enter owner/name</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-700" />
          <Input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, Math.max(choices.length - 1, 0)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                const choice = choices[activeIndex];
                if (choice && !watchedNames.has(choice.fullName.toLowerCase()) && !watching) {
                  event.preventDefault();
                  onWatch(choice.fullName);
                } else if (canWatchManual && !manualAlreadyWatched && !watching) {
                  event.preventDefault();
                  onWatch(manualCandidate);
                }
              }
            }}
            placeholder="Search GitHub repos or enter owner/name..."
            spellCheck={false}
            className="h-11 w-full border-gray-alpha-300 bg-background-200 pl-10 text-[14px] text-gray-1000 shadow-none placeholder:text-gray-700 hover:border-gray-alpha-400 focus-visible:border-gray-alpha-600 focus-visible:ring-0"
            autoFocus
          />
        </label>
        <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-[minmax(160px,1.25fr)_minmax(140px,1fr)_minmax(150px,1fr)_minmax(130px,0.85fr)_auto]">
          <label>
            <span className={filterLabelClassName}>Owner</span>
            <NativeSelect value={owner} onChange={(event) => setOwner(event.target.value)} className={selectClassName}>
              <NativeSelectOption value="all">All owners</NativeSelectOption>
              {owners.map((item) => (
                <NativeSelectOption key={item} value={item}>
                  {item}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label>
            <span className={filterLabelClassName}>Visibility</span>
            <NativeSelect
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as RepoVisibilityFilter)}
              className={selectClassName}
            >
              <NativeSelectOption value="all">Any visibility</NativeSelectOption>
              <NativeSelectOption value="private">Private</NativeSelectOption>
              <NativeSelectOption value="public">Public</NativeSelectOption>
            </NativeSelect>
          </label>
          <label>
            <span className={filterLabelClassName}>Watch state</span>
            <NativeSelect value={watch} onChange={(event) => setWatch(event.target.value as RepoWatchFilter)} className={selectClassName}>
              <NativeSelectOption value="unwatched">Unwatched</NativeSelectOption>
              <NativeSelectOption value="watched">Watched</NativeSelectOption>
              <NativeSelectOption value="all">All watched states</NativeSelectOption>
            </NativeSelect>
          </label>
          <label>
            <span className={filterLabelClassName}>Kind</span>
            <NativeSelect value={kind} onChange={(event) => setKind(event.target.value as RepoKindFilter)} className={selectClassName}>
              <NativeSelectOption value="all">Any kind</NativeSelectOption>
              <NativeSelectOption value="sources">Sources</NativeSelectOption>
              <NativeSelectOption value="forks">Forks</NativeSelectOption>
              <NativeSelectOption value="archives">Archived</NativeSelectOption>
              <NativeSelectOption value="templates">Templates</NativeSelectOption>
            </NativeSelect>
          </label>
          <label className="col-span-2 md:col-span-1 md:self-end">
            <span className="sr-only">Recent repositories only</span>
            <span className="flex h-9 items-center gap-2 rounded-md border border-gray-alpha-300 bg-background-200 px-3 text-[13px] text-gray-900 transition-colors hover:border-gray-alpha-400 hover:text-gray-1000">
              <Checkbox checked={recentOnly} onCheckedChange={(checked) => setRecentOnly(checked === true)} className="size-3.5" />
              Recent
            </span>
          </label>
        </div>
      </div>
      {canWatchManual && (
        <div className="flex items-center justify-between gap-4 rounded-md border border-gray-alpha-300 bg-gray-alpha-100 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-mono text-[13px] font-medium text-gray-1000">{manualCandidate}</div>
            <div className="mt-1 text-[12px] leading-5 text-gray-700">
              {manualAlreadyWatched ? "This repository is already watched." : "Watch this repository by full name."}
            </div>
          </div>
          <Button
            type="button"
            disabled={watching || manualAlreadyWatched}
            onClick={() => onWatch(manualCandidate)}
            className="h-8 px-3 text-[13px]"
            title={manualAlreadyWatched ? `${manualCandidate} is already watched.` : manualWatchLabel}
          >
            {watching ? "Watching..." : manualAlreadyWatched ? "Watched" : "Watch"}
          </Button>
        </div>
      )}
      <div className="overflow-hidden rounded-md border border-gray-alpha-300 bg-background-200">
        <div className="flex items-center justify-between gap-3 border-b border-gray-alpha-200 px-4 py-2.5 text-[12px] text-gray-700">
          <span>{loading ? "Loading repositories" : `${totalFilteredCount} matching repositories`}</span>
          <span className="hidden sm:inline">Use arrow keys and Enter to watch</span>
        </div>
        <div className="max-h-[min(480px,calc(86vh-310px))] overflow-y-auto">
          {loading && <div className="px-4 py-4 text-[13px] text-gray-700">Loading GitHub repositories...</div>}
          {!loading && choices.length === 0 && <div className="px-4 py-4 text-[13px] text-gray-700">No matching repositories.</div>}
          {choices.map((repo, index) => {
            const watched = watchedNames.has(repo.fullName.toLowerCase());
            const watchedRepo = watchedByName.get(repo.fullName.toLowerCase());
            const visibilityLabel = repo.isPrivate ? "Private" : repo.visibility === "internal" ? "Internal" : "Public";
            return (
              <Button
                key={repo.id}
                type="button"
                variant="ghost"
                disabled={watching || watched}
                onClick={() => onWatch(repo.fullName)}
                title={
                  watching
                    ? "Wait for the current repository watch request to finish."
                    : watched
                      ? `${repo.fullName} is already watched.`
                      : `Watch ${repo.fullName}`
                }
                className={`group h-auto w-full justify-between rounded-none border-b border-gray-alpha-200 px-4 py-3.5 text-left transition-colors last:border-b-0 disabled:opacity-50 ${
                  index === activeIndex ? "bg-gray-alpha-100" : "hover:bg-gray-alpha-100"
                }`}
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Avatar seed={repo.owner} src={repo.ownerAvatarUrl} size="md" />
                  <div className="min-w-0 pt-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[14px] font-medium text-gray-1000">{repo.fullName}</span>
                      <span className="shrink-0 rounded border border-gray-alpha-300 px-1.5 py-0.5 text-[10px] uppercase text-gray-700">
                        {visibilityLabel}
                      </span>
                      {repo.isFork && (
                        <span className="hidden shrink-0 rounded border border-gray-alpha-300 px-1.5 py-0.5 text-[10px] uppercase text-gray-700 sm:inline">
                          Fork
                        </span>
                      )}
                      {repo.archived && (
                        <span className="hidden shrink-0 rounded border border-gray-alpha-300 px-1.5 py-0.5 text-[10px] uppercase text-gray-700 sm:inline">
                          Archived
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 truncate text-[13px] text-gray-800">{repo.description ?? "No description"}</div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-gray-700">
                      <span>{repo.defaultBranch ?? "No default branch"}</span>
                      <span>{repo.language ?? "Language unknown"}</span>
                      <span>{repo.pushedAt ? `pushed ${formatRelative(repo.pushedAt)}` : "push time unknown"}</span>
                    </div>
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-2 self-center pl-2 text-[13px] text-gray-800 group-hover:text-gray-1000">
                  {watchedRepo && <BranchIntegrityBadge summary={branchIntegrityByRepo.get(watchedRepo.id)} compact />}
                  <span>{watched ? "Watched" : "Watch"}</span>
                </span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
