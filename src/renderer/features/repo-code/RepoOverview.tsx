import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckIcon as GitHubCheckIcon,
  GitPullRequestIcon as GitHubPullRequestIcon,
  IssueOpenedIcon as GitHubIssueOpenedIcon,
  PulseIcon as GitHubPulseIcon,
  RepoForkedIcon as GitHubRepoForkedIcon,
  SearchIcon as GitHubSearchIcon,
  TagIcon as GitHubTagIcon
} from "@primer/octicons-react";
import { Database, SearchCheck } from "lucide-react";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type { RepoCodeSummary, RepoCommitSummary } from "../../../shared/domain/repo-code";
import { CacheTimestamp } from "../../components/CacheTimestamp";
import { Surface } from "../../components/ui";
import { BranchIntegrityBadge } from "../branch-integrity/BranchIntegrityBadge";
import { formatBytes, formatRelative, repoSizeTitle, shortSha } from "../../lib/format";

const REPO_ENTITY_LIST_STALE_TIME_MS = 5 * 60_000;
const REPO_ENTITY_LIST_GC_TIME_MS = 30 * 60_000;

function MetricCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden p-4 border-r border-neutral-800 last:border-r-0 flex flex-col space-y-1.5 bg-black">
      <div className="truncate text-[12px] text-neutral-400">{label}</div>
      <div className="min-w-0 text-[14px] text-neutral-200 font-medium">{value}</div>
    </div>
  );
}

function byUpdatedDesc(a: { updatedAt: string | null }, b: { updatedAt: string | null }): number {
  return timestamp(b.updatedAt) - timestamp(a.updatedAt);
}

function timestamp(value: string | null): number {
  return value ? new Date(value).getTime() : 0;
}

export function RepoMetricGrid({ repo, codeSummary }: { repo: WatchedRepo; codeSummary?: RepoCodeSummary }) {
  const { data: integritySummary } = useQuery({
    queryKey: ["branchIntegritySummary", repo.id],
    queryFn: () => window.fallback.branchIntegrity.summary(repo.id),
    staleTime: 30_000
  });
  return (
    <Surface className="repo-metric-grid">
      <MetricCard
        label="Default Branch"
        value={
          <span className="flex items-center space-x-2">
            <GitHubRepoForkedIcon className="w-[14px] h-[14px] text-neutral-400" />
            <span>{codeSummary?.defaultBranch ?? repo.defaultBranch ?? "main"}</span>
          </span>
        }
      />
      <MetricCard
        label="Last Commit"
        value={
          <span className="flex items-center space-x-2">
            <div className="w-[14px] h-[14px] rounded-full border border-neutral-400 flex items-center justify-center -rotate-45">
              <span className="w-1 h-1 bg-neutral-400 rounded-full block"></span>
            </div>
            <span>{codeSummary?.latestCommit?.committedAt ? formatRelative(codeSummary.latestCommit.committedAt) : "Never"}</span>
          </span>
        }
      />
      <MetricCard
        label="Latest Release"
        value={
          <span className="flex min-w-0 items-center space-x-2" title={codeSummary?.latestReleaseName ?? "No release"}>
            <GitHubTagIcon className="w-[14px] h-[14px] shrink-0 text-neutral-400" />
            <span className="min-w-0 truncate">{codeSummary?.latestReleaseName ?? "No release"}</span>
          </span>
        }
      />
      <MetricCard
        label="Repo Size"
        value={
          <span className="flex items-start space-x-2" title={repoSizeTitle(codeSummary)}>
            <Database className="w-[14px] h-[14px] text-neutral-400" />
            <span className="flex flex-col min-w-0">
              <span>{codeSummary?.totalStoredBytes != null ? formatBytes(codeSummary.totalStoredBytes) : "Unknown"}</span>
              {codeSummary?.cachedBytes ? (
                <span className="text-[11px] text-neutral-500 font-normal">cache + {formatBytes(codeSummary.cachedBytes)}</span>
              ) : null}
            </span>
          </span>
        }
      />
      <MetricCard
        label="License"
        value={
          <span className="flex items-center space-x-2">
            <SearchCheck className="w-[14px] h-[14px] text-neutral-400" />
            <span>{codeSummary?.licenseName ?? "Unknown"}</span>
          </span>
        }
      />
      <MetricCard label="Branch Watch" value={<BranchIntegrityBadge summary={integritySummary} compact />} />
      <MetricCard
        label="Activity"
        value={
          <span className="flex min-w-0 items-center space-x-2">
            <GitHubPulseIcon className="w-[14px] h-[14px] text-neutral-400 shrink-0" />
            <span className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
              <span className="shrink-0">{repo.syncStatus === "fresh" ? "Fresh" : repo.syncStatus.replace("_", " ")}</span>
              <CacheTimestamp
                cachedAt={codeSummary?.cachedAt ?? repo.lastSuccessfulSyncAt}
                fromCache={codeSummary?.fromCache}
                className="truncate text-[11px] font-normal"
              />
            </span>
          </span>
        }
      />
    </Surface>
  );
}

export function LatestCommitCard({
  repo,
  commit,
  cachedAt,
  fromCache,
  onViewHistory
}: {
  repo: WatchedRepo;
  commit: RepoCommitSummary | null;
  cachedAt?: string | null;
  fromCache?: boolean;
  onViewHistory: () => void;
}) {
  const author = commit?.authorLogin ?? commit?.authorName ?? "unknown";

  return (
    <div className="border border-neutral-800 bg-black rounded-[5px] overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between text-[13px]">
        <div className="flex items-center gap-3">
          <div className="text-neutral-400 font-medium">Latest commit</div>
          <CacheTimestamp cachedAt={cachedAt} fromCache={fromCache} />
        </div>
        <button
          type="button"
          onClick={onViewHistory}
          className="text-neutral-400 hover:text-neutral-300 cursor-pointer flex items-center space-x-1 transition-colors"
        >
          <span>View history</span>
          <span>→</span>
        </button>
      </div>
      <div className="p-4">
        <div className="flex items-start space-x-3 mb-2">
          <div className="w-8 h-8 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-sm text-neutral-300 font-medium shrink-0 mt-0.5">
            {author[0]?.toUpperCase() ?? "?"}
          </div>
          <div>
            <div className="flex items-center space-x-1.5 text-[13px] mb-1">
              <span className="font-medium text-neutral-200">{author}</span>
              <span className="text-neutral-500">
                {commit?.committedAt ? `authored ${formatRelative(commit.committedAt)}` : repo.lastSuccessfulSyncAt ? "cached locally" : ""}
              </span>
            </div>
            <div className="text-[14px] text-neutral-200 hover:text-blue-900 cursor-pointer transition-colors leading-relaxed">
              {commit?.message ?? "No commit cached yet."}
            </div>
            <div className="flex items-center space-x-3 mt-2 text-[13px]">
              <div className="flex items-center space-x-1 text-neutral-500">
                <span className="w-3 h-3 rounded-full border border-neutral-500 inline-block"></span>
                <span className="font-mono text-[12px] hover:text-blue-900 cursor-pointer transition-colors">
                  {commit ? shortSha(commit.sha) : "unknown"}
                </span>
              </div>
              {commit?.verified && (
                <>
                  <div className="text-neutral-600">·</div>
                  <div className="flex items-center space-x-1 text-green-900">
                    <GitHubCheckIcon className="w-[14px] h-[14px]" />
                    <span>Verified</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RepoOverview({ repo, codeSummary }: { repo: WatchedRepo; codeSummary?: RepoCodeSummary }) {
  const { data: prs = [] } = useQuery({
    queryKey: ["prs", repo.id],
    queryFn: () => window.fallback.prs.list(repo.id),
    enabled: Boolean(repo.id),
    staleTime: REPO_ENTITY_LIST_STALE_TIME_MS,
    gcTime: REPO_ENTITY_LIST_GC_TIME_MS
  });
  const { data: issueResult } = useQuery({
    queryKey: ["issues", repo.id],
    queryFn: () => window.fallback.issues.list(repo.id, { state: "open", limit: 25, offset: 0 }),
    enabled: Boolean(repo.id),
    staleTime: REPO_ENTITY_LIST_STALE_TIME_MS,
    gcTime: REPO_ENTITY_LIST_GC_TIME_MS
  });
  const issues = issueResult?.items ?? [];

  const latestPr = prs.sort(byUpdatedDesc)[0];

  return (
    <div className="space-y-6">
      <RepoMetricGrid repo={repo} codeSummary={codeSummary} />

      {/* Latest Activity Bar */}
      {latestPr && (
        <div className="border border-neutral-800 bg-black rounded-[5px] overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between text-[13px]">
            <div className="text-neutral-400 font-medium">Latest pull request</div>
            <div className="text-neutral-400 hover:text-neutral-300 cursor-pointer flex items-center space-x-1 transition-colors">
              <span>View all</span>
              <span>→</span>
            </div>
          </div>
          <div className="p-4">
            <div className="flex items-start space-x-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-sm text-neutral-300 font-medium shrink-0 mt-0.5">
                {(latestPr.authorLogin ?? "?")[0].toUpperCase()}
              </div>
              <div>
                <div className="flex items-center space-x-1.5 text-[13px] mb-1">
                  <span className="font-medium text-neutral-200">{latestPr.authorLogin ?? "unknown"}</span>
                  <span className="text-neutral-500">{latestPr.updatedAt ? `updated ${formatRelative(latestPr.updatedAt)}` : ""}</span>
                </div>
                <div className="text-[14px] text-neutral-200 hover:text-blue-900 cursor-pointer transition-colors leading-relaxed">
                  {latestPr.title}
                </div>
                <div className="flex items-center space-x-3 mt-2 text-[13px]">
                  <div className="flex items-center space-x-1 text-neutral-500">
                    <span className="w-3 h-3 rounded-full border border-neutral-500 inline-block"></span>
                    <span className="font-mono text-[12px]">#{latestPr.number}</span>
                  </div>
                  <div className="text-neutral-600">·</div>
                  <div
                    className={`flex items-center space-x-1 ${latestPr.merged ? "text-purple-900" : latestPr.state === "open" ? "text-green-900" : "text-red-900"}`}
                  >
                    <span className="capitalize">{latestPr.merged ? "Merged" : latestPr.state}</span>
                  </div>
                  {latestPr.commentsCount !== null && latestPr.commentsCount > 0 && (
                    <>
                      <div className="text-neutral-600">·</div>
                      <div className="text-neutral-500">{latestPr.commentsCount} comments</div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent PRs and Issues list */}
      <div className="border border-neutral-800 rounded-[5px] bg-black overflow-hidden mb-12">
        <div className="flex items-center justify-between p-2 border-b border-neutral-800 bg-black">
          <div className="flex items-center space-x-2 text-[13px] text-neutral-400 w-full max-w-xl relative">
            <GitHubSearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              aria-label="Search cached repository activity"
              type="text"
              placeholder="Search cached data..."
              className="bg-[#0a0a0a] border border-neutral-800 rounded-md py-1.5 pl-9 pr-8 focus:border-neutral-700 w-full placeholder:text-neutral-600 text-neutral-200 transition-colors"
            />
          </div>
        </div>

        {/* List Header */}
        <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-neutral-800 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider bg-black">
          <div className="col-span-4">Name</div>
          <div className="col-span-5 hidden md:block">Description</div>
          <div className="col-span-3 text-right">Updated</div>
        </div>

        <div className="divide-y divide-neutral-800">
          {prs.slice(0, 4).map((pr) => (
            <div
              key={pr.id}
              className="grid grid-cols-12 gap-4 px-4 py-2.5 text-[13px] hover:bg-[#111111] cursor-pointer items-center transition-colors group"
            >
              <div className="col-span-4 flex items-center space-x-2.5 overflow-hidden">
                <GitHubPullRequestIcon className="w-[18px] h-[18px] text-neutral-500 shrink-0" />
                <div className="truncate text-neutral-200 group-hover:text-blue-900 transition-colors">
                  #{pr.number} {pr.title}
                </div>
              </div>
              <div className="col-span-5 text-neutral-500 hidden md:block truncate group-hover:text-neutral-400 transition-colors">
                {pr.authorLogin ?? "unknown"} · {pr.state}
              </div>
              <div className="col-span-3 text-neutral-500 text-right group-hover:text-neutral-400 transition-colors">
                {pr.updatedAt ? formatRelative(pr.updatedAt) : "unknown"}
              </div>
            </div>
          ))}
          {issues.slice(0, 3).map((issue) => (
            <div
              key={issue.id}
              className="grid grid-cols-12 gap-4 px-4 py-2.5 text-[13px] hover:bg-[#111111] cursor-pointer items-center transition-colors group"
            >
              <div className="col-span-4 flex items-center space-x-2.5 overflow-hidden">
                <GitHubIssueOpenedIcon className="w-[18px] h-[18px] text-neutral-500 shrink-0" />
                <div className="truncate text-neutral-200 group-hover:text-blue-900 transition-colors">
                  #{issue.number} {issue.title}
                </div>
              </div>
              <div className="col-span-5 text-neutral-500 hidden md:block truncate group-hover:text-neutral-400 transition-colors">
                {issue.authorLogin ?? "unknown"} · {issue.state}
              </div>
              <div className="col-span-3 text-neutral-500 text-right group-hover:text-neutral-400 transition-colors">
                {issue.updatedAt ? formatRelative(issue.updatedAt) : "unknown"}
              </div>
            </div>
          ))}
          {prs.length === 0 && issues.length === 0 && (
            <div className="px-4 py-8 text-center text-neutral-500 text-sm">No cached data yet. Sync this repo to populate.</div>
          )}
        </div>
      </div>
    </div>
  );
}
