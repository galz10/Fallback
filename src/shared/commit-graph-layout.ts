import type { CommitGraphEdge } from "./domain/repo-code.js";

export interface CommitGraphLayoutInputNode {
  sha: string;
  parentShas: string[];
}

export interface CommitGraphLayoutRow {
  sha: string;
  lane: number;
  activeLanesBefore: number[];
  activeLanesAfter: number[];
  edges: CommitGraphEdge[];
}

export interface CommitGraphLayout {
  rows: CommitGraphLayoutRow[];
  maxLane: number;
}

export function layoutCommitGraph(nodes: CommitGraphLayoutInputNode[]): CommitGraphLayout {
  const knownShas = new Set(nodes.map((node) => node.sha));
  const active: Array<string | null> = [];
  const rows: CommitGraphLayoutRow[] = [];
  let maxLane = 0;

  for (const node of nodes) {
    const activeLanesBefore = activeLanes(active);
    let lane = active.indexOf(node.sha);
    if (lane === -1) {
      lane = firstAvailableLane(active);
      active[lane] = node.sha;
    }
    maxLane = Math.max(maxLane, lane, active.length - 1);

    const edges: CommitGraphEdge[] = [];
    const firstParent = node.parentShas[0] ?? null;
    if (firstParent && knownShas.has(firstParent)) {
      active[lane] = firstParent;
      edges.push({ fromLane: lane, toLane: lane, parentSha: firstParent, status: "loaded" });
    } else {
      active[lane] = null;
      if (firstParent) edges.push({ fromLane: lane, toLane: lane, parentSha: firstParent, status: "missing" });
    }

    for (const parentSha of node.parentShas.slice(1)) {
      if (!knownShas.has(parentSha)) {
        edges.push({ fromLane: lane, toLane: lane, parentSha, status: "missing" });
        continue;
      }

      let parentLane = active.indexOf(parentSha);
      if (parentLane === -1) {
        parentLane = firstAvailableLane(active);
        active[parentLane] = parentSha;
      }
      maxLane = Math.max(maxLane, parentLane, active.length - 1);
      edges.push({ fromLane: lane, toLane: parentLane, parentSha, status: "loaded" });
    }

    trimTrailingEmptyLanes(active);
    maxLane = Math.max(maxLane, active.length - 1);
    rows.push({
      sha: node.sha,
      lane,
      activeLanesBefore,
      activeLanesAfter: activeLanes(active),
      edges
    });
  }

  return { rows, maxLane: Math.max(0, maxLane) };
}

function firstAvailableLane(active: Array<string | null>): number {
  const index = active.indexOf(null);
  return index === -1 ? active.length : index;
}

function activeLanes(active: Array<string | null>): number[] {
  return active.flatMap((sha, lane) => (sha ? [lane] : []));
}

function trimTrailingEmptyLanes(active: Array<string | null>): void {
  while (active.length > 0 && active[active.length - 1] == null) active.pop();
}
