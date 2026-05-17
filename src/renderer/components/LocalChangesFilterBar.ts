import React from "react";
import type { LocalChangeDisplayMode, LocalChangeStageFilter, LocalChangeStatusFilter } from "../../shared/local-changes-tree.js";

interface LocalChangesFilterBarProps {
  displayMode: LocalChangeDisplayMode;
  onDisplayModeChange: (mode: LocalChangeDisplayMode) => void;
  query: string;
  onQueryChange: (query: string) => void;
  status: LocalChangeStatusFilter;
  onStatusChange: (status: LocalChangeStatusFilter) => void;
  stage: LocalChangeStageFilter;
  onStageChange: (stage: LocalChangeStageFilter) => void;
  resultCount: number;
  totalCount: number;
}

const statuses: LocalChangeStatusFilter[] = ["all", "tracked", "modified", "added", "deleted", "renamed", "copied", "untracked"];
const stages: LocalChangeStageFilter[] = ["all", "staged", "unstaged"];

export function LocalChangesFilterBar({
  displayMode,
  onDisplayModeChange,
  query,
  onQueryChange,
  status,
  onStatusChange,
  stage,
  onStageChange,
  resultCount,
  totalCount
}: LocalChangesFilterBarProps) {
  const hasActiveFilters = status !== "all" || stage !== "all" || displayMode !== "flat";
  const filterSummary = [displayMode, status !== "all" ? status : null, stage !== "all" ? stage : null].filter(Boolean).join(" · ");

  return React.createElement(
    "div",
    { className: "space-y-2 border-b border-neutral-900 bg-[#060606] px-3 py-2.5" },
    React.createElement(
      "div",
      { className: "flex items-center gap-2" },
      React.createElement(
        "div",
        { className: "ui-search-field ui-search-field-compact min-w-0 flex-1" },
        React.createElement("input", {
          "aria-label": "Filter changed files",
          value: query,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => onQueryChange(event.currentTarget.value),
          placeholder: "Find changed files",
          className: "ui-search-field-input !h-8 !border-neutral-800/80 !bg-black/20 pl-3 !text-[12px]"
        })
      ),
      React.createElement("span", { className: "shrink-0 font-mono text-[11px] text-neutral-600" }, `${resultCount}/${totalCount}`)
    ),
    React.createElement(
      "details",
      { className: "group text-[11px] text-neutral-500" },
      React.createElement(
        "summary",
        {
          className:
            "flex h-7 cursor-pointer list-none items-center justify-between rounded-md px-1.5 text-neutral-500 outline-none transition-colors hover:bg-neutral-900/60 hover:text-neutral-300 focus-visible:ring-1 focus-visible:ring-neutral-600 [&::-webkit-details-marker]:hidden"
        },
        React.createElement("span", null, "View & filters"),
        React.createElement(
          "span",
          { className: hasActiveFilters ? "font-mono text-neutral-300" : "font-mono text-neutral-700" },
          hasActiveFilters ? filterSummary : "default"
        )
      ),
      React.createElement(
        "div",
        { className: "mt-2 flex flex-wrap items-center gap-1.5" },
        React.createElement(
          "div",
          {
            className: "ui-segmented-control !rounded-md !border-neutral-800/80 !bg-black/20 !p-0.5",
            role: "group",
            "aria-label": "Changed files display mode"
          },
          (["flat", "tree"] as LocalChangeDisplayMode[]).map((mode) =>
            React.createElement(
              "button",
              {
                key: mode,
                type: "button",
                "aria-pressed": displayMode === mode,
                onClick: () => onDisplayModeChange(mode),
                className: `ui-segmented-control-item h-7 ${
                  displayMode === mode ? "ui-segmented-control-item-active bg-neutral-900 text-neutral-200" : "text-neutral-500"
                }`
              },
              mode === "flat" ? "Flat" : "Tree"
            )
          )
        ),
        React.createElement(
          "select",
          {
            "aria-label": "Status filter",
            value: status,
            onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onStatusChange(event.currentTarget.value as LocalChangeStatusFilter),
            className: "h-7 rounded-md border border-neutral-800/80 bg-black/20 px-2 text-[11px] text-neutral-400"
          },
          statuses.map((item) => React.createElement("option", { key: item, value: item }, item))
        ),
        React.createElement(
          "select",
          {
            "aria-label": "Stage filter",
            value: stage,
            onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onStageChange(event.currentTarget.value as LocalChangeStageFilter),
            className: "h-7 rounded-md border border-neutral-800/80 bg-black/20 px-2 text-[11px] text-neutral-400"
          },
          stages.map((item) => React.createElement("option", { key: item, value: item }, item === "all" ? "all stages" : item))
        )
      )
    )
  );
}
