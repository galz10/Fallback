import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertIcon as GitHubAlertIcon,
  FileDirectoryIcon as GitHubFileDirectoryIcon,
  FileIcon as GitHubFileIcon,
  PlusIcon as GitHubPlusIcon
} from "@primer/octicons-react";
import { ChevronDown } from "lucide-react";
import { Button as UiButton, EmptyState, SearchField, Surface, Toolbar } from "../../components/ui";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type { RepoCodeSummary, RepoFileEntry } from "../../../shared/domain/repo-code";
import { CacheTimestamp } from "../../components/CacheTimestamp";
import { GitNetworkControls } from "./GitNetworkControls";
import { LatestCommitCard, RepoMetricGrid } from "./RepoOverview";
import { parentPath, sortRepoFiles } from "./repo-paths";
import { formatBytes, formatRelative } from "../../lib/format";
import type { RepoFileOpenTarget } from "./RepoCodeView";
import { FileContentView } from "./FileContentView";
import { ReadmePanel } from "./ReadmePanel";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readmeRank(name: string): number {
  const normalized = name.toLowerCase();
  const priority = ["readme.md", "readme.mdx", "readme.markdown", "readme.txt", "readme.rst", "readme"];
  const index = priority.indexOf(normalized);
  return index === -1 ? priority.length : index;
}

function findReadmeFile(files: RepoFileEntry[]): RepoFileEntry | null {
  const candidates = files
    .filter((file) => file.type === "file" && /^readme(?:$|\.)/i.test(file.name))
    .sort((a, b) => readmeRank(a.name) - readmeRank(b.name) || a.name.localeCompare(b.name));
  return candidates[0] ?? null;
}

function readmeCollapsedStorageKey(repoId: string): string {
  return `fallback:repo-readme-collapsed:${repoId}`;
}

function readStoredReadmeCollapsed(repoId: string): boolean {
  try {
    const stored = localStorage.getItem(readmeCollapsedStorageKey(repoId));
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

function writeStoredReadmeCollapsed(repoId: string, collapsed: boolean): void {
  try {
    localStorage.setItem(readmeCollapsedStorageKey(repoId), collapsed ? "true" : "false");
  } catch {
    // Keep the in-memory state even if persistence is unavailable.
  }
}

export function FilesWorkflow({
  repo,
  codeSummary,
  fileOpenTarget,
  onViewHistory
}: {
  repo: WatchedRepo;
  codeSummary?: RepoCodeSummary;
  fileOpenTarget: RepoFileOpenTarget | null;
  onViewHistory: () => void;
}) {
  const [path, setPath] = useState("");
  const [filter, setFilter] = useState("");
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const [readmeCollapsed, setReadmeCollapsed] = useState(() => readStoredReadmeCollapsed(repo.id));
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const {
    data: files = [],
    isFetching,
    error,
    refetch
  } = useQuery({
    queryKey: ["repoFiles", repo.id, path],
    queryFn: () => window.fallback.repos.listFiles(repo.id, path),
    enabled: Boolean(repo.id),
    staleTime: 60_000
  });
  const readmeFile = path ? null : findReadmeFile(files);
  const {
    data: readme,
    isFetching: readmeFetching,
    error: readmeError
  } = useQuery({
    queryKey: ["repoFileContent", repo.id, readmeFile?.path],
    queryFn: () => {
      if (!readmeFile) throw new Error("README file not found.");
      return window.fallback.repos.readFile(repo.id, readmeFile.path);
    },
    enabled: Boolean(repo.id && readmeFile?.path),
    staleTime: 60_000
  });

  useEffect(() => {
    setPath("");
    setFilter("");
    setReadmeCollapsed(readStoredReadmeCollapsed(repo.id));
    setSelectedFilePath(null);
  }, [repo.id]);

  useEffect(() => {
    if (fileOpenTarget) setSelectedFilePath(fileOpenTarget.path);
  }, [fileOpenTarget]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "t" || event.metaKey || event.ctrlKey || event.altKey || isTextEntryTarget(event.target)) {
        return;
      }
      if (!filterInputRef.current) return;
      event.preventDefault();
      filterInputRef.current?.focus();
      filterInputRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (selectedFilePath) {
    return <FileContentView repo={repo} filePath={selectedFilePath} onBack={() => setSelectedFilePath(null)} />;
  }

  const visibleFiles = [...files]
    .filter((file) => !filter.trim() || file.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort(sortRepoFiles);
  const latestCommit = codeSummary?.latestCommit ?? null;
  const filesCachedAt = files[0]?.cachedAt ?? codeSummary?.cachedAt ?? null;
  const filesFromCache = files[0]?.fromCache ?? codeSummary?.fromCache ?? false;
  const handleReadmeCollapsedChange = (collapsed: boolean) => {
    setReadmeCollapsed(collapsed);
    writeStoredReadmeCollapsed(repo.id, collapsed);
  };

  return (
    <div className="space-y-6">
      <GitNetworkControls repo={repo} />
      <RepoMetricGrid repo={repo} codeSummary={codeSummary} />

      {readmeFile && (
        <ReadmePanel
          repo={repo}
          readmeFile={readmeFile}
          readme={readme}
          isFetching={readmeFetching}
          error={readmeError}
          collapsed={readmeCollapsed}
          onCollapsedChange={handleReadmeCollapsedChange}
        />
      )}

      <LatestCommitCard
        repo={repo}
        commit={latestCommit}
        cachedAt={codeSummary?.cachedAt}
        fromCache={codeSummary?.fromCache}
        onViewHistory={onViewHistory}
      />

      <Surface className="mb-12">
        <Toolbar>
          <div className="w-full max-w-xl">
            <SearchField
              ref={filterInputRef}
              aria-label="Search repository files"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Go to file"
              shortcut="T"
              density="compact"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CacheTimestamp cachedAt={filesCachedAt} fromCache={filesFromCache} className="hidden lg:inline" />
            <UiButton disabled title="Adding files from Fallback is not available yet" variant="secondary" size="sm">
              <GitHubPlusIcon className="w-[14px] h-[14px]" />
              <span>Add file</span>
              <ChevronDown className="w-3 h-3" />
            </UiButton>
            <UiButton onClick={() => refetch()} disabled={isFetching} variant="primary" size="sm">
              <span>{isFetching ? "Refreshing..." : "Refresh files"}</span>
            </UiButton>
          </div>
        </Toolbar>

        <div className="repo-file-table-header grid grid-cols-12 gap-4 px-4 py-3 border-b border-neutral-800 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider bg-black">
          <div className="col-span-4">Name</div>
          <div className="col-span-5 hidden md:block">Last Commit Message</div>
          <div className="col-span-3 text-right">Last Commit</div>
        </div>

        <div>
          {path && (
            <button
              onClick={() => setPath(parentPath(path))}
              className="repo-file-row ui-data-row w-full grid grid-cols-12 gap-4 px-4 py-2.5 text-[13px] cursor-pointer items-center transition-colors group"
            >
              <div className="col-span-4 flex items-center space-x-2.5 overflow-hidden">
                <GitHubFileDirectoryIcon className="w-[18px] h-[18px] text-neutral-500 shrink-0" />
                <div className="truncate text-neutral-200 group-hover:text-blue-900 transition-colors">..</div>
              </div>
              <div className="repo-file-row-message col-span-5 text-neutral-500 hidden md:block truncate group-hover:text-neutral-400 transition-colors">
                Parent directory
              </div>
              <div className="repo-file-row-age col-span-3 text-neutral-500 text-right group-hover:text-neutral-400 transition-colors">
                -
              </div>
            </button>
          )}

          {isFetching && files.length === 0 && <EmptyState title="Loading files..." />}

          {error && (
            <div className="px-4 py-8 text-center text-red-900 text-sm flex items-center justify-center gap-2">
              <GitHubAlertIcon className="w-4 h-4" />
              <span>{errorMessage(error)}</span>
            </div>
          )}

          {!isFetching && !error && visibleFiles.length === 0 && (
            <EmptyState title={filter.trim() ? "No matching files." : "No files found."} />
          )}

          {visibleFiles.map((file) => (
            <button
              key={file.path}
              onClick={() => {
                if (file.type === "dir") setPath(file.path);
                if (file.type === "file") setSelectedFilePath(file.path);
              }}
              className={`w-full grid grid-cols-12 gap-4 px-4 py-2.5 text-[13px] items-center transition-colors group ${
                file.type === "dir" || file.type === "file" ? "repo-file-row ui-data-row cursor-pointer" : "repo-file-row cursor-default"
              }`}
            >
              <div className="col-span-4 flex items-center space-x-2.5 overflow-hidden">
                {file.type === "dir" ? (
                  <GitHubFileDirectoryIcon className="w-[18px] h-[18px] text-neutral-500 shrink-0" />
                ) : (
                  <GitHubFileIcon className="w-[18px] h-[18px] text-neutral-500 shrink-0" />
                )}
                <div className="truncate text-neutral-200 group-hover:text-blue-900 transition-colors">{file.name}</div>
              </div>
              <div className="repo-file-row-message col-span-5 text-neutral-500 hidden md:block truncate group-hover:text-neutral-400 transition-colors">
                {latestCommit?.message ?? (file.type === "dir" ? "Directory" : "File")}
              </div>
              <div className="repo-file-row-age col-span-3 text-neutral-500 text-right group-hover:text-neutral-400 transition-colors">
                {latestCommit?.committedAt
                  ? formatRelative(latestCommit.committedAt)
                  : file.type === "file" && file.size != null
                    ? formatBytes(file.size)
                    : "-"}
              </div>
            </button>
          ))}
        </div>
      </Surface>
    </div>
  );
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null
  );
}
