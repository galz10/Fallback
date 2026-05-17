import React from "react";
import { Copy, ExternalLink, RotateCcw } from "lucide-react";
import type { CommitGraphNode, CommitGraphViewModel } from "../../../shared/domain/repo-code";
import { formatRelative } from "../../lib/format";

const commitGraphLanePalette = [
  "hsl(var(--ds-blue-900))",
  "hsl(var(--ds-green-900))",
  "hsl(var(--ds-amber-800))",
  "hsl(var(--ds-purple-900))",
  "hsl(var(--ds-teal-900))",
  "hsl(var(--ds-pink-900))"
] as const;

function commitGraphLaneColor(lane: number): string {
  const index = Math.abs(lane) % commitGraphLanePalette.length;
  return commitGraphLanePalette[index] ?? commitGraphLanePalette[0];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function CommitGraphPanel({
  graph,
  fetching,
  error,
  nodes,
  selectedNode,
  hasSearch,
  onSelect,
  onCopySha,
  onOpenCommit,
  onRevertCommit
}: {
  graph: CommitGraphViewModel | null;
  fetching: boolean;
  error: unknown;
  nodes: CommitGraphNode[];
  selectedNode: CommitGraphNode | null;
  hasSearch: boolean;
  onSelect: (node: CommitGraphNode) => void;
  onCopySha: (sha: string) => void;
  onOpenCommit: (url: string) => void;
  onRevertCommit: (node: CommitGraphNode) => void;
}) {
  if (fetching && !graph) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-[#0A0A0A] p-8 text-center text-sm text-neutral-500">
        Loading commit graph...
      </div>
    );
  }

  if (error && !graph) {
    return <div className="rounded-md border border-red-700/30 bg-red-200/35 px-3 py-2 text-sm text-red-900">{errorMessage(error)}</div>;
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="border border-neutral-800 rounded-lg p-12 bg-[#0A0A0A] text-center">
        <p className="text-neutral-400 text-lg font-medium mb-2">No graph available</p>
        <p className="text-neutral-500 text-sm">{graph?.message ?? "Local Git history is not available for this repository yet."}</p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="space-y-3">
        <CommitGraphStatusBanner graph={graph} />
        <div className="border border-neutral-800 rounded-lg p-12 bg-[#0A0A0A] text-center">
          <p className="text-neutral-400 text-lg font-medium mb-2">No commits matched</p>
          <p className="text-neutral-500 text-sm">
            {hasSearch ? "Try a different author, SHA, message, date, branch, or path filter." : graph.message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <CommitGraphStatusBanner graph={graph} />
      <div className="min-h-[480px] overflow-auto border-y border-neutral-900">
        <div className="min-w-[760px]">
          <div className="grid h-8 grid-cols-[112px_72px_minmax(0,1fr)_180px_132px] items-center gap-2 border-b border-neutral-900 px-3 text-[11px] uppercase tracking-wide text-neutral-600">
            <span title="Stations are commits. Colored rails follow parent history. Curves show branch or merge movement.">History</span>
            <span>SHA</span>
            <span>Commit</span>
            <span>Author</span>
            <span className="text-right">Actions</span>
          </div>
          {nodes.map((node, index) => {
            const selected = selectedNode?.sha === node.sha;
            const author = node.authorName ?? node.authorEmail ?? "unknown";
            const visibleRefs = node.refs
              .filter((ref) => ref.kind !== "head")
              .filter((ref) => selected || ref.isDefault || ref.isCurrent)
              .slice(0, selected ? 2 : 1);
            return (
              <div
                key={node.sha}
                role="option"
                aria-selected={selected}
                tabIndex={0}
                onClick={() => onSelect(node)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(node);
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    onSelect(nodes[Math.min(nodes.length - 1, index + 1)]);
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    onSelect(nodes[Math.max(0, index - 1)]);
                  }
                }}
                className={`grid min-h-[54px] w-full grid-cols-[112px_72px_minmax(0,1fr)_180px_132px] items-center gap-2 border-b border-neutral-900 px-3 text-left transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-900 ${
                  selected ? "bg-[#111111]" : "hover:bg-[#0D0D0D]"
                }`}
              >
                <CommitGraphLaneSvg node={node} selected={selected} />
                <span className={`font-mono text-xs tabular-nums ${selected ? "text-neutral-100" : "text-neutral-400"}`}>
                  {node.shortSha}
                </span>
                <div className="min-w-0 space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`min-w-0 truncate text-sm font-medium ${selected ? "text-white" : "text-neutral-300"}`}>
                      {node.message}
                    </span>
                    {node.isHead && <CommitGraphRefBadge label="HEAD" kind="head" strong />}
                    {visibleRefs.map((ref) => (
                      <CommitGraphRefBadge
                        key={`${node.sha}:inline:${ref.fullName}`}
                        label={ref.name}
                        kind={ref.kind}
                        strong={ref.isDefault || ref.isCurrent}
                      />
                    ))}
                    {node.parentShas.length > 1 && (
                      <span className="shrink-0 rounded border border-neutral-800 bg-black px-1.5 py-0.5 font-mono text-[11px] text-neutral-500">
                        {node.parentShas.length} parents
                      </span>
                    )}
                  </div>
                  {selected && node.refs.length > visibleRefs.length + (node.isHead ? 1 : 0) && (
                    <div className="font-mono text-[11px] text-neutral-600">
                      +{node.refs.length - visibleRefs.length - (node.isHead ? 1 : 0)} more refs
                    </div>
                  )}
                </div>
                <div className="min-w-0 text-xs text-neutral-500">
                  <div className="truncate font-medium text-neutral-400">{author}</div>
                  <div>{node.committedAt ? formatRelative(node.committedAt) : "time unknown"}</div>
                </div>
                <div
                  aria-hidden={!selected}
                  className={`flex items-center justify-end gap-1 transition-opacity ${
                    selected ? "opacity-100" : "pointer-events-none opacity-0"
                  }`}
                >
                  <button
                    type="button"
                    tabIndex={selected ? 0 : -1}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCopySha(node.sha);
                    }}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-neutral-800 bg-black px-2 text-xs text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-950"
                    title="Copy SHA"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy</span>
                  </button>
                  {node.htmlUrl && (
                    <button
                      type="button"
                      tabIndex={selected ? 0 : -1}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenCommit(node.htmlUrl!);
                      }}
                      className="inline-flex h-7 items-center justify-center rounded-md px-2 text-neutral-500 transition-colors hover:bg-black hover:text-white"
                      title="Open commit"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    tabIndex={selected ? 0 : -1}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRevertCommit(node);
                    }}
                    className="inline-flex h-7 items-center justify-center rounded-md px-2 text-neutral-500 transition-colors hover:bg-red-200/35 hover:text-red-900"
                    title="Revert commit"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CommitGraphLaneSvg({ node, selected }: { node: CommitGraphNode; selected: boolean }) {
  const width = 112;
  const height = 54;
  const centerY = height / 2;
  const laneStep = 17;
  const maxVisibleLane = 5;
  const laneX = (lane: number) => 12 + Math.min(Math.max(0, lane), maxVisibleLane) * laneStep;
  const visibleLanes = (lanes: number[]) => [...new Set(lanes.map((lane) => Math.min(Math.max(0, lane), maxVisibleLane)))];
  const isMerge = node.parentShas.length > 1;
  const currentLaneColor = commitGraphLaneColor(node.lane);
  const trackBed = "#050505";
  const missingTrack = "hsl(var(--ds-gray-500) / 0.48)";
  const edgePath = (fromLane: number, toLane: number) => {
    const x1 = laneX(fromLane);
    const x2 = laneX(toLane);
    if (x1 === x2) return `M ${x1} ${centerY} V ${height}`;
    const bendY = centerY + 15;
    return `M ${x1} ${centerY} C ${x1} ${bendY}, ${x2} ${bendY}, ${x2} ${height}`;
  };

  return (
    <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0 overflow-visible">
      {visibleLanes(node.activeLanesBefore).map((lane) => (
        <React.Fragment key={`before:${lane}`}>
          <line x1={laneX(lane)} x2={laneX(lane)} y1="0" y2={centerY} stroke={trackBed} strokeWidth="7" strokeLinecap="round" />
          <line
            x1={laneX(lane)}
            x2={laneX(lane)}
            y1="0"
            y2={centerY}
            stroke={commitGraphLaneColor(lane)}
            strokeWidth="3.25"
            strokeLinecap="round"
            opacity={selected && lane === node.lane ? 1 : 0.82}
          />
        </React.Fragment>
      ))}
      {visibleLanes(node.activeLanesAfter).map((lane) => (
        <React.Fragment key={`after:${lane}`}>
          <line x1={laneX(lane)} x2={laneX(lane)} y1={centerY} y2={height} stroke={trackBed} strokeWidth="7" strokeLinecap="round" />
          <line
            x1={laneX(lane)}
            x2={laneX(lane)}
            y1={centerY}
            y2={height}
            stroke={commitGraphLaneColor(lane)}
            strokeWidth="3.25"
            strokeLinecap="round"
            opacity={selected && lane === node.lane ? 1 : 0.82}
          />
        </React.Fragment>
      ))}
      {node.edges.map((edge) => {
        const path = edgePath(edge.fromLane, edge.toLane);
        const color = edge.status === "missing" ? missingTrack : commitGraphLaneColor(edge.toLane);
        return (
          <React.Fragment key={`${node.sha}:${edge.parentSha}:${edge.toLane}`}>
            <path d={path} fill="none" stroke={trackBed} strokeWidth="7" strokeLinecap="round" />
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={selected ? "4" : "3.25"}
              strokeLinecap="round"
              strokeDasharray={edge.status === "missing" ? "4 5" : undefined}
              opacity={edge.status === "missing" ? 0.7 : selected ? 1 : 0.9}
            />
          </React.Fragment>
        );
      })}
      {isMerge && (
        <circle
          cx={laneX(node.lane) + 7}
          cy={centerY - 8}
          r={3.25}
          fill="#050505"
          stroke={commitGraphLaneColor(node.lane + 1)}
          strokeWidth="2"
        />
      )}
      <circle cx={laneX(node.lane)} cy={centerY} r={7.5} fill="#050505" />
      <circle
        cx={laneX(node.lane)}
        cy={centerY}
        r={selected ? 6 : 5.5}
        fill="#EDEDED"
        stroke={currentLaneColor}
        strokeWidth={selected ? "3" : "2.5"}
      />
      <circle cx={laneX(node.lane)} cy={centerY} r={selected ? 2.25 : 1.6} fill={selected ? currentLaneColor : "#111111"} />
    </svg>
  );
}

function CommitGraphStatusBanner({ graph }: { graph: CommitGraphViewModel }) {
  if (graph.status === "ok" || graph.status === "capped" || graph.status === "stale") return null;
  const risky = graph.status === "error" || graph.status === "git_missing";
  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm ${
        risky ? "border-red-700/30 bg-red-200/35 text-red-900" : "border-neutral-800 bg-[#0A0A0A] text-neutral-400"
      }`}
    >
      {graph.message}
    </div>
  );
}

function CommitGraphRefBadge({ label, kind, strong = false }: { label: string; kind: string; strong?: boolean }) {
  const cleanLabel = label.trim();
  if (!cleanLabel) return null;
  const className = strong
    ? "border-neutral-700 bg-[#0D0D0D] text-neutral-300"
    : kind === "tag"
      ? "border-amber-700/30 bg-amber-200/15 text-amber-200"
      : kind === "head"
        ? "border-blue-900/40 bg-blue-900/10 text-blue-200"
        : kind === "stash"
          ? "border-purple-700/30 bg-purple-200/15 text-purple-200"
          : "border-neutral-800 bg-black text-neutral-400";
  return (
    <span
      className={`inline-flex min-w-0 max-w-[148px] shrink items-center rounded border px-1.5 py-0.5 font-mono text-[11px] ${className}`}
    >
      <span className="truncate">{cleanLabel}</span>
    </span>
  );
}
