import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertIcon as GitHubAlertIcon,
  GitPullRequestIcon as GitHubPullRequestIcon,
  SearchIcon as GitHubSearchIcon,
  TagIcon as GitHubTagIcon
} from "@primer/octicons-react";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type { RepoBranchSummary, RepoContributorSummary, RepoReleaseSummary, RepoTagSummary } from "../../../shared/domain/repo-code";
import { Avatar } from "../../components/Avatar";
import { CacheTimestamp } from "../../components/CacheTimestamp";
import { compactCount, formatRelative, shortSha } from "../../lib/format";

function matchesText(value: string | null | undefined, term: string): boolean {
  return value?.toLowerCase().includes(term.trim().toLowerCase()) ?? false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BranchesView({ repo }: { repo: WatchedRepo }) {
  const [filter, setFilter] = useState("");
  const {
    data: branches = [],
    isFetching,
    error
  } = useQuery({
    queryKey: ["repoBranches", repo.id],
    queryFn: () => window.fallback.repos.listBranches(repo.id),
    staleTime: 60_000
  });
  const visible = branches.filter((branch) => matchesText(branch.name, filter));

  return (
    <RepoReferenceList
      title={`${compactCount(branches.length)} branches`}
      cachedAt={branches[0]?.cachedAt}
      fromCache={branches[0]?.fromCache}
      placeholder="Find a branch"
      filter={filter}
      onFilter={setFilter}
      loading={isFetching && branches.length === 0}
      error={error}
      emptyText={filter.trim() ? "No matching branches." : "No branches found."}
    >
      {visible.map((branch) => (
        <BranchRow key={branch.name} branch={branch} />
      ))}
    </RepoReferenceList>
  );
}

function BranchRow({ branch }: { branch: RepoBranchSummary }) {
  return (
    <div className="grid grid-cols-12 gap-4 px-4 py-3 text-sm hover:bg-neutral-900/50 items-center transition-colors group">
      <div className="col-span-6 flex items-center space-x-3 overflow-hidden">
        <GitHubPullRequestIcon className="w-5 h-5 text-neutral-500 shrink-0" />
        <div className="truncate text-neutral-300 group-hover:text-white transition-colors font-medium">{branch.name}</div>
        {branch.isDefault && (
          <span className="text-[11px] text-blue-900 border border-blue-700/30 bg-blue-200/35 px-1.5 py-0.5 rounded">Default</span>
        )}
        {branch.protected && (
          <span className="text-[11px] text-green-900 border border-green-700/30 bg-green-200/35 px-1.5 py-0.5 rounded">Protected</span>
        )}
      </div>
      <div className="col-span-4 text-neutral-500 hidden md:block truncate">Branch</div>
      <div className="col-span-6 md:col-span-2 text-neutral-500 text-right font-mono text-xs">
        {branch.sha ? shortSha(branch.sha) : "-"}
      </div>
    </div>
  );
}

export function TagsView({ repo }: { repo: WatchedRepo }) {
  const [filter, setFilter] = useState("");
  const {
    data: tags = [],
    isFetching,
    error
  } = useQuery({
    queryKey: ["repoTags", repo.id],
    queryFn: () => window.fallback.repos.listTags(repo.id),
    staleTime: 60_000
  });
  const visible = tags.filter((tag) => matchesText(tag.name, filter));

  return (
    <RepoReferenceList
      title={`${compactCount(tags.length)} tags`}
      cachedAt={tags[0]?.cachedAt}
      fromCache={tags[0]?.fromCache}
      placeholder="Find a tag"
      filter={filter}
      onFilter={setFilter}
      loading={isFetching && tags.length === 0}
      error={error}
      emptyText={filter.trim() ? "No matching tags." : "No tags found."}
    >
      {visible.map((tag) => (
        <TagRow key={tag.name} tag={tag} />
      ))}
    </RepoReferenceList>
  );
}

function TagRow({ tag }: { tag: RepoTagSummary }) {
  return (
    <div className="grid grid-cols-12 gap-4 px-4 py-3 text-sm hover:bg-neutral-900/50 items-center transition-colors group">
      <div className="col-span-6 flex items-center space-x-3 overflow-hidden">
        <GitHubTagIcon className="w-5 h-5 text-neutral-500 shrink-0" />
        <div className="truncate text-neutral-300 group-hover:text-white transition-colors font-medium">{tag.name}</div>
      </div>
      <div className="col-span-4 text-neutral-500 hidden md:flex items-center space-x-2">
        <button className="text-neutral-400 hover:text-white border border-neutral-800 rounded px-2 py-1 text-xs transition-colors">
          Zip
        </button>
        <button className="text-neutral-400 hover:text-white border border-neutral-800 rounded px-2 py-1 text-xs transition-colors">
          Tar
        </button>
      </div>
      <div className="col-span-6 md:col-span-2 text-neutral-500 text-right font-mono text-xs">{tag.sha ? shortSha(tag.sha) : "-"}</div>
    </div>
  );
}

export function ReleasesView({ repo }: { repo: WatchedRepo }) {
  const [filter, setFilter] = useState("");
  const {
    data: releases = [],
    isFetching,
    error
  } = useQuery({
    queryKey: ["repoReleases", repo.id],
    queryFn: () => window.fallback.repos.listReleases(repo.id),
    staleTime: 60_000
  });
  const visible = releases.filter((release) => matchesText(release.name ?? release.tagName, filter));

  return (
    <RepoReferenceList
      title={`${compactCount(releases.length)} releases`}
      cachedAt={releases[0]?.cachedAt}
      fromCache={releases[0]?.fromCache}
      placeholder="Find a release"
      filter={filter}
      onFilter={setFilter}
      loading={isFetching && releases.length === 0}
      error={error}
      emptyText={filter.trim() ? "No matching releases." : "No releases found."}
    >
      {visible.map((release) => (
        <ReleaseRow key={`${release.id}:${release.tagName}`} release={release} />
      ))}
    </RepoReferenceList>
  );
}

function ReleaseRow({ release }: { release: RepoReleaseSummary }) {
  const publishedAt = release.publishedAt ?? release.createdAt;
  const title = release.name || release.tagName;
  const body = release.body?.trim();
  const openRelease = () => {
    if (release.htmlUrl) void window.fallback.shell.openExternal(release.htmlUrl);
  };

  return (
    <div className="grid grid-cols-12 gap-4 px-4 py-3 text-sm hover:bg-neutral-900/50 items-start transition-colors group">
      <div className="col-span-7 flex min-w-0 items-start space-x-3">
        <GitHubTagIcon className="mt-0.5 h-5 w-5 shrink-0 text-neutral-500" />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {release.htmlUrl ? (
              <button
                type="button"
                onClick={openRelease}
                className="truncate text-left font-medium text-neutral-300 transition-colors group-hover:text-white"
              >
                {title}
              </button>
            ) : (
              <span className="truncate font-medium text-neutral-300 transition-colors group-hover:text-white">{title}</span>
            )}
            {release.prerelease && (
              <span className="rounded border border-amber-700/30 bg-amber-200/35 px-1.5 py-0.5 text-[11px] text-amber-900">
                Prerelease
              </span>
            )}
            {release.draft && (
              <span className="rounded border border-blue-700/30 bg-blue-200/35 px-1.5 py-0.5 text-[11px] text-blue-900">Draft</span>
            )}
          </div>
          <div className="mt-1 font-mono text-xs text-neutral-600">{release.tagName}</div>
          {body && <div className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-500">{body}</div>}
        </div>
      </div>
      <div className="col-span-3 hidden min-w-0 text-neutral-500 md:block">
        {release.authorLogin ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar seed={release.authorLogin} src={release.authorAvatarUrl} size="sm" />
            <span className="truncate">{release.authorLogin}</span>
          </span>
        ) : (
          "Release"
        )}
      </div>
      <div className="col-span-5 text-right text-xs text-neutral-500 md:col-span-2">
        {publishedAt ? formatRelative(publishedAt) : "date unknown"}
      </div>
    </div>
  );
}

export function ContributorsView({ repo }: { repo: WatchedRepo }) {
  const [filter, setFilter] = useState("");
  const {
    data: contributors = [],
    isFetching,
    error
  } = useQuery({
    queryKey: ["repoContributors", repo.id],
    queryFn: () => window.fallback.repos.listContributors(repo.id),
    staleTime: 60_000
  });
  const visible = contributors.filter((contributor) => matchesText(contributor.login, filter));

  return (
    <RepoReferenceList
      title={`${compactCount(contributors.length)} contributors`}
      cachedAt={contributors[0]?.cachedAt}
      fromCache={contributors[0]?.fromCache}
      placeholder="Find a contributor"
      filter={filter}
      onFilter={setFilter}
      loading={isFetching && contributors.length === 0}
      error={error}
      emptyText={filter.trim() ? "No matching contributors." : "No contributors found."}
    >
      {visible.map((contributor) => (
        <ContributorRow key={contributor.login} contributor={contributor} />
      ))}
    </RepoReferenceList>
  );
}

function ContributorRow({ contributor }: { contributor: RepoContributorSummary }) {
  return (
    <div className="grid grid-cols-12 gap-4 px-4 py-3 text-sm hover:bg-neutral-900/50 items-center transition-colors group">
      <div className="col-span-7 flex items-center space-x-3 overflow-hidden">
        <Avatar seed={contributor.login} src={contributor.avatarUrl} size="md" />
        <div className="truncate text-neutral-300 group-hover:text-white transition-colors font-medium">{contributor.login}</div>
      </div>
      <div className="col-span-3 text-neutral-500 hidden md:block truncate">Contributor</div>
      <div className="col-span-5 md:col-span-2 text-neutral-500 text-right text-xs">{compactCount(contributor.contributions)} commits</div>
    </div>
  );
}

function RepoReferenceList({
  title,
  cachedAt,
  fromCache,
  placeholder,
  filter,
  onFilter,
  loading,
  error,
  emptyText,
  children
}: {
  title: string;
  cachedAt?: string | null;
  fromCache?: boolean;
  placeholder: string;
  filter: string;
  onFilter: (value: string) => void;
  loading: boolean;
  error: unknown;
  emptyText: string;
  children: React.ReactNode;
}) {
  const hasRows = React.Children.count(children) > 0;

  return (
    <div className="border border-neutral-800 rounded-lg bg-[#0A0A0A] overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-neutral-800 bg-[#111111]">
        <div className="flex items-center space-x-2 text-sm text-neutral-400 flex-1 relative">
          <GitHubSearchIcon className="w-4 h-4 absolute left-2 text-neutral-500" />
          <input
            aria-label={placeholder}
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
            placeholder={placeholder}
            className="bg-transparent border-none pl-8 w-full placeholder:text-neutral-600 text-neutral-200"
          />
        </div>
        <div className="text-neutral-500 text-xs font-mono ml-4 flex items-center gap-3 whitespace-nowrap">
          <CacheTimestamp cachedAt={cachedAt} fromCache={fromCache} />
          <span>{title}</span>
        </div>
      </div>
      <div className="divide-y divide-neutral-800/50">
        {loading && <div className="px-4 py-8 text-center text-neutral-500 text-sm">Loading...</div>}
        {Boolean(error) && (
          <div className="px-4 py-8 text-center text-red-900 text-sm flex items-center justify-center gap-2">
            <GitHubAlertIcon className="w-4 h-4" />
            <span>{errorMessage(error)}</span>
          </div>
        )}
        {!loading && !error && !hasRows && <div className="px-4 py-8 text-center text-neutral-500 text-sm">{emptyText}</div>}
        {children}
      </div>
    </div>
  );
}
