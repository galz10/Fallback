import React, { useEffect, useMemo, useRef } from "react";
import { preparePresortedFileTreeInput } from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import { CheckIcon as GitHubCheckIcon, FileIcon as GitHubFileIcon } from "@primer/octicons-react";
import { Archive, RotateCcw } from "lucide-react";
import type { LocalChangeFile } from "../../../shared/domain/local-git";
import {
  changedFileGitStatus,
  changedFileTreePaths,
  localChangeFileKey,
  type LocalChangeDisplayMode,
  type LocalChangeStageFilter,
  type LocalChangeStatusFilter
} from "../../../shared/local-changes-tree";
import { LocalChangesFilterBar } from "../../components/LocalChangesFilterBar";

export function ChangedFilesPanel({
  allStaged,
  busy,
  busyActionReason,
  displayMode,
  files,
  filteredFiles,
  selectedFile,
  selectedStashFiles,
  selectedStashPaths,
  stagedCount,
  stageFilter,
  statusFilter,
  query,
  onClearStashSelection,
  onDiscard,
  onDisplayModeChange,
  onQueryChange,
  onSelectPath,
  onStageAll,
  onStageFilterChange,
  onStatusFilterChange,
  onToggleStage,
  onToggleStashSelection
}: {
  allStaged: boolean;
  busy: boolean;
  busyActionReason: string;
  displayMode: LocalChangeDisplayMode;
  files: LocalChangeFile[];
  filteredFiles: LocalChangeFile[];
  selectedFile: LocalChangeFile | null;
  selectedStashFiles: LocalChangeFile[];
  selectedStashPaths: Set<string>;
  stagedCount: number;
  stageFilter: LocalChangeStageFilter;
  statusFilter: LocalChangeStatusFilter;
  query: string;
  onClearStashSelection: () => void;
  onDiscard: (file: LocalChangeFile) => void;
  onDisplayModeChange: (mode: LocalChangeDisplayMode) => void;
  onQueryChange: (query: string) => void;
  onSelectPath: (path: string) => void;
  onStageAll: () => void;
  onStageFilterChange: (filter: LocalChangeStageFilter) => void;
  onStatusFilterChange: (filter: LocalChangeStatusFilter) => void;
  onToggleStage: (file: LocalChangeFile) => void;
  onToggleStashSelection: (file: LocalChangeFile) => void;
}) {
  return (
    <aside className="min-w-0 border-b border-neutral-900 bg-[#070707] xl:border-b-0 xl:border-r xl:border-neutral-900">
      <section className="border-b border-neutral-900">
        <div className="flex h-10 items-center justify-between border-b border-neutral-900 bg-[#080808] px-3 text-[12px] text-neutral-500">
          <button
            onClick={onStageAll}
            disabled={busy}
            title={busy ? busyActionReason : allStaged ? "Unstage every changed file." : "Stage every changed file."}
            className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:text-neutral-200 disabled:opacity-50"
          >
            <LocalStageCheckbox checked={allStaged} />
            <span>{allStaged ? "Unstage all" : "Stage all"}</span>
          </button>
          <span className="font-mono text-[11px] text-neutral-600">
            {stagedCount}/{files.length} staged
          </span>
        </div>
        <LocalChangesFilterBar
          displayMode={displayMode}
          onDisplayModeChange={onDisplayModeChange}
          query={query}
          onQueryChange={onQueryChange}
          status={statusFilter}
          onStatusChange={onStatusFilterChange}
          stage={stageFilter}
          onStageChange={onStageFilterChange}
          resultCount={filteredFiles.length}
          totalCount={files.length}
        />
        <div className="space-y-1 p-2">
          {selectedStashFiles.length > 0 && (
            <div className="flex items-center justify-between rounded-md border border-white/[0.12] bg-white/[0.055] px-2.5 py-1.5 text-[12px] shadow-[inset_0_1px_0_rgb(255_255_255_/_0.035)]">
              <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-neutral-100">
                <Archive className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                <span className="truncate">{selectedStashFiles.length} selected for stash</span>
              </span>
              <button
                onClick={onClearStashSelection}
                disabled={busy}
                title={busy ? busyActionReason : "Clear selected stash files."}
                className="ml-3 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-neutral-400 transition-colors hover:bg-white/[0.07] hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          )}
          {filteredFiles.length === 0 ? (
            <div className="rounded-md border border-neutral-900 bg-[#050505] px-3 py-8 text-center text-[13px] text-neutral-600">
              No changed files match this filter.
            </div>
          ) : displayMode === "tree" ? (
            <LocalChangeTree
              files={filteredFiles}
              selectedPath={selectedFile?.path ?? null}
              selectedStashPaths={selectedStashPaths}
              busy={busy}
              onSelect={onSelectPath}
              onToggleStashSelection={onToggleStashSelection}
              onToggleStage={onToggleStage}
              onDiscard={onDiscard}
            />
          ) : (
            filteredFiles.map((file) => (
              <LocalChangeFileRow
                key={localChangeFileKey(file)}
                file={file}
                active={file.path === selectedFile?.path}
                selectedForStash={selectedStashPaths.has(file.path)}
                busy={busy}
                onSelect={() => onSelectPath(file.path)}
                onToggleStashSelection={() => onToggleStashSelection(file)}
                onToggleStage={() => onToggleStage(file)}
                onDiscard={() => onDiscard(file)}
              />
            ))
          )}
        </div>
      </section>
    </aside>
  );
}

function LocalChangeTree({
  files,
  selectedPath,
  selectedStashPaths,
  busy,
  onSelect,
  onToggleStashSelection,
  onToggleStage,
  onDiscard
}: {
  files: LocalChangeFile[];
  selectedPath: string | null;
  selectedStashPaths: Set<string>;
  busy: boolean;
  onSelect: (path: string) => void;
  onToggleStashSelection: (file: LocalChangeFile) => void;
  onToggleStage: (file: LocalChangeFile) => void;
  onDiscard: (file: LocalChangeFile) => void;
}) {
  const paths = useMemo(() => changedFileTreePaths(files), [files]);
  const fileByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const fileByPathRef = useRef(fileByPath);
  const onSelectRef = useRef(onSelect);
  const gitStatus = useMemo(() => changedFileGitStatus(files), [files]);
  const preparedInput = useMemo(() => preparePresortedFileTreeInput(paths), [paths]);
  const selectedFile = selectedPath ? (fileByPath.get(selectedPath) ?? null) : null;
  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    gitStatus,
    initialExpansion: "open",
    initialSelectedPaths: selectedPath && fileByPath.has(selectedPath) ? [selectedPath] : [],
    initialVisibleRowCount: Math.min(10, Math.max(3, paths.length)),
    itemHeight: 30,
    paths,
    preparedInput,
    search: false,
    stickyFolders: true,
    onSelectionChange: (selectedPaths) => {
      const nextPath = selectedPaths[selectedPaths.length - 1];
      if (nextPath && fileByPathRef.current.has(nextPath)) onSelectRef.current(nextPath);
    },
    renderRowDecoration: ({ item }) => {
      if (item.kind !== "file") return null;
      const file = fileByPathRef.current.get(item.path);
      if (!file) return null;
      const stats = [file.additions > 0 ? `+${file.additions}` : null, file.deletions > 0 ? `-${file.deletions}` : null]
        .filter(Boolean)
        .join(" ");
      return stats
        ? {
            text: stats,
            title: `${file.additions} additions, ${file.deletions} deletions.`
          }
        : null;
    },
    unsafeCSS: `
      :host {
        --trees-bg-override: transparent;
        --trees-bg-muted-override: transparent;
        --trees-fg-override: rgb(163 163 163);
        --trees-fg-muted-override: rgb(82 82 82);
        --trees-border-color-override: rgb(32 32 32);
        --trees-selected-fg-override: rgb(245 245 245);
        --trees-selected-bg-override: rgb(23 23 23);
        --trees-selected-focused-border-color-override: rgb(64 64 64);
        --trees-focus-ring-color-override: rgb(64 64 64);
        --trees-status-modified-override: rgb(115 115 115);
        --trees-status-untracked-override: rgb(115 115 115);
        --trees-status-added-override: rgb(115 115 115);
        --trees-status-deleted-override: rgb(248 113 113);
        --trees-git-modified-color-override: rgb(115 115 115);
        --trees-git-untracked-color-override: rgb(115 115 115);
        --trees-git-added-color-override: rgb(115 115 115);
        --trees-git-deleted-color-override: rgb(248 113 113);
        --trees-file-icon-color: rgb(82 82 82);
        --trees-action-lane-width-override: 0px;
        --trees-padding-inline-override: 10px;
        background: transparent !important;
      }

      [data-file-tree-virtualized-wrapper='true'],
      [data-file-tree-virtualized-root='true'],
      [data-file-tree-virtualized-scroll='true'] {
        background: transparent !important;
        background-color: transparent !important;
      }

      [data-item-section='git'],
      [data-item-section='action'],
      [data-type='context-menu-anchor'] {
        display: none !important;
      }
    `
  });
  const treeHeight = Math.min(320, Math.max(108, paths.length * 30 + 18));

  useEffect(() => {
    fileByPathRef.current = fileByPath;
  }, [fileByPath]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    model.resetPaths(paths, { preparedInput });
    model.setGitStatus(gitStatus);
  }, [gitStatus, model, paths, preparedInput]);

  return (
    <div className="space-y-2">
      <PierreFileTree
        model={model}
        className="overflow-hidden rounded-md border border-neutral-900/90 bg-transparent"
        style={{ height: treeHeight }}
      />
      {selectedFile ? (
        <LocalChangeTreeActions
          file={selectedFile}
          selectedForStash={selectedStashPaths.has(selectedFile.path)}
          busy={busy}
          onToggleStashSelection={() => onToggleStashSelection(selectedFile)}
          onToggleStage={() => onToggleStage(selectedFile)}
          onDiscard={() => onDiscard(selectedFile)}
        />
      ) : (
        <div className="border-t border-neutral-900 px-2 py-3 text-center text-[12px] text-neutral-600">
          Select a changed file to stage, unstage, or discard it.
        </div>
      )}
    </div>
  );
}

function LocalChangeTreeActions({
  file,
  selectedForStash,
  busy,
  onToggleStashSelection,
  onToggleStage,
  onDiscard
}: {
  file: LocalChangeFile;
  selectedForStash: boolean;
  busy: boolean;
  onToggleStashSelection: () => void;
  onToggleStage: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="border-t border-neutral-900 px-1 pt-2">
      <div className="grid grid-cols-3 gap-1">
        <button
          onClick={onToggleStashSelection}
          disabled={busy}
          title={selectedForStash ? "Remove from stash selection" : "Select file for stash"}
          className={`inline-flex h-7 items-center justify-center gap-1 rounded-md border px-2 text-[11px] transition-colors disabled:opacity-50 ${
            selectedForStash
              ? "border-sky-500/20 bg-sky-500/10 text-sky-200 hover:bg-sky-500/15"
              : "border-neutral-900 bg-[#070707] text-neutral-500 hover:border-neutral-800 hover:bg-[#101010] hover:text-neutral-200"
          }`}
        >
          <Archive className="h-3 w-3" />
          {selectedForStash ? "Stashed" : "Stash"}
        </button>
        <button
          onClick={onToggleStage}
          disabled={busy}
          className="h-7 rounded-md border border-neutral-900 bg-[#070707] px-2 text-[11px] text-neutral-400 transition-colors hover:border-neutral-800 hover:bg-[#101010] hover:text-neutral-100 disabled:opacity-50"
        >
          {file.staged && !file.unstaged ? "Unstage" : "Stage"}
        </button>
        <button
          onClick={onDiscard}
          disabled={busy}
          className="h-7 rounded-md border border-neutral-900 bg-[#070707] px-2 text-[11px] text-neutral-500 transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function LocalChangeFileRow({
  file,
  active,
  selectedForStash,
  busy,
  onSelect,
  onToggleStashSelection,
  onToggleStage,
  onDiscard
}: {
  file: LocalChangeFile;
  active: boolean;
  selectedForStash: boolean;
  busy: boolean;
  onSelect: () => void;
  onToggleStashSelection: () => void;
  onToggleStage: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      className={`group flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors ${
        active
          ? "bg-[#111111] text-neutral-100 shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.04)]"
          : "text-neutral-500 hover:bg-[#111111] hover:text-neutral-200 focus-within:bg-[#111111] focus-within:text-neutral-200"
      }`}
    >
      <button
        type="button"
        onClick={onToggleStage}
        disabled={busy}
        className={busy ? "opacity-50" : ""}
        title={file.staged && !file.unstaged ? "Unstage file" : "Stage file"}
        aria-label={file.staged && !file.unstaged ? `Unstage ${file.path}` : `Stage ${file.path}`}
        aria-pressed={file.staged && file.unstaged ? "mixed" : file.staged && !file.unstaged}
      >
        <LocalStageCheckbox checked={file.staged && !file.unstaged} mixed={file.staged && file.unstaged} />
      </button>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <GitHubFileIcon className="h-4 w-4 shrink-0 text-neutral-600" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
        <span className="shrink-0 font-mono text-[11px]">
          {file.additions > 0 && <span className="text-emerald-500">+{file.additions}</span>}
          {file.additions > 0 && file.deletions > 0 && <span className="text-neutral-700"> </span>}
          {file.deletions > 0 && <span className="text-red-500">-{file.deletions}</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={onToggleStashSelection}
        disabled={busy}
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-md transition-colors ${
          selectedForStash
            ? "bg-white/[0.08] text-neutral-100 ring-1 ring-white/[0.12]"
            : "text-neutral-700 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-neutral-900 hover:text-neutral-300"
        } ${busy ? "opacity-50" : ""}`}
        title={selectedForStash ? "Remove from selected stash" : "Select for stash"}
        aria-label={selectedForStash ? `Remove ${file.path} from selected stash` : `Select ${file.path} for stash`}
        aria-pressed={selectedForStash}
      >
        <Archive className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onDiscard}
        disabled={busy}
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-neutral-700 transition-colors group-hover:text-neutral-500 hover:bg-red-950/20 hover:text-red-300 ${
          active ? "text-neutral-500" : ""
        } ${busy ? "opacity-50" : ""}`}
        title="Discard changes"
        aria-label={`Discard changes in ${file.path}`}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function LocalStageCheckbox({ checked, mixed = false }: { checked: boolean; mixed?: boolean }) {
  return (
    <span
      className={`grid h-[15px] w-[15px] place-items-center rounded-[4px] border ${
        checked || mixed ? "border-white/40 bg-white/[0.08] text-neutral-200" : "border-white/[0.14] text-transparent"
      }`}
      aria-hidden="true"
    >
      {mixed ? <span className="h-px w-2 bg-current" /> : <GitHubCheckIcon className="h-3 w-3" />}
    </span>
  );
}
