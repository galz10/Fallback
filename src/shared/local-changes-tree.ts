import type { GitStatusEntry } from "@pierre/trees";
import type { LocalChangeFile } from "./domain/local-git.js";

export type LocalChangeDisplayMode = "flat" | "tree";
export type LocalChangeStageFilter = "all" | "staged" | "unstaged";
export type LocalChangeStatusFilter = "all" | "tracked" | LocalChangeFile["status"];

export interface LocalChangeFilters {
  query: string;
  status: LocalChangeStatusFilter;
  stage: LocalChangeStageFilter;
}

export interface ChangedFileTreeNode {
  name: string;
  path: string;
  fileCount: number;
  files: LocalChangeFile[];
  children: ChangedFileTreeNode[];
}

export function filterLocalChangeFiles(files: LocalChangeFile[], filters: LocalChangeFilters): LocalChangeFile[] {
  const query = filters.query.trim().toLowerCase();
  return files.filter((file) => {
    if (query && !file.path.toLowerCase().includes(query) && !(file.previousPath ?? "").toLowerCase().includes(query)) return false;
    if (filters.status === "tracked" && file.status === "untracked") return false;
    if (filters.status !== "all" && filters.status !== "tracked" && file.status !== filters.status) return false;
    if (filters.stage === "staged" && !file.staged) return false;
    if (filters.stage === "unstaged" && !file.unstaged) return false;
    return true;
  });
}

export function buildChangedFileTree(files: LocalChangeFile[]): ChangedFileTreeNode[] {
  const root: ChangedFileTreeNode = { name: "", path: "", fileCount: 0, files: [], children: [] };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    if (parts.length === 1) {
      root.files.push(file);
      root.fileCount += 1;
      continue;
    }
    let node = root;
    let currentPath = "";
    node.fileCount += 1;
    for (const part of parts.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let child = node.children.find((item) => item.name === part);
      if (!child) {
        child = { name: part, path: currentPath, fileCount: 0, files: [], children: [] };
        node.children.push(child);
      }
      child.fileCount += 1;
      node = child;
    }
    node.files.push(file);
  }
  const topLevel = [...root.children];
  if (root.files.length > 0) topLevel.unshift({ name: "(root)", path: "", fileCount: root.files.length, files: root.files, children: [] });
  return sortedTreeNodes(topLevel).map(normalizeTreeNode);
}

export function changedFileTreePaths(files: LocalChangeFile[]): string[] {
  return [...new Set(files.map((file) => file.path))].sort((left, right) => left.localeCompare(right));
}

export function changedFileGitStatus(files: LocalChangeFile[]): GitStatusEntry[] {
  return files.map((file) => ({
    path: file.path,
    status: file.status === "copied" ? "modified" : file.status
  }));
}

export function localChangeFileKey(file: LocalChangeFile): string {
  return `${file.previousPath ?? ""}:${file.path}`;
}

function normalizeTreeNode(node: ChangedFileTreeNode): ChangedFileTreeNode {
  return {
    ...node,
    files: [...node.files].sort((left, right) => left.path.localeCompare(right.path)),
    children: sortedTreeNodes(node.children).map(normalizeTreeNode)
  };
}

function sortedTreeNodes(nodes: ChangedFileTreeNode[]): ChangedFileTreeNode[] {
  return nodes.sort((left, right) => left.name.localeCompare(right.name));
}
