import fs from "node:fs";
import path from "node:path";
import { assertLocalPath } from "../ipc/validation.js";

export interface TrustedShellPathServices {
  settings: {
    get(): { workspacePath: string };
  };
  database: {
    localCache?: {
      repos: {
        listWatchedReposForActiveAccount(): Array<{ id: string; localPath?: string | null }>;
      };
      repoWorkspaces: {
        listRepoWorkspaces(repoId: string): Array<{ localPath: string }>;
      };
    };
    listWatchedReposForActiveAccount?(): Array<{ id: string; localPath?: string | null }>;
    listRepoWorkspaces?(repoId: string): Array<{ localPath: string }>;
  };
}

export function assertTrustedLocalPath(services: TrustedShellPathServices, value: unknown): string {
  const targetPath = path.resolve(assertLocalPath(value));
  if (!path.isAbsolute(targetPath)) throw new Error("Path must be absolute.");
  const trustedRoots = trustedShellRoots(services);
  if (trustedRoots.some((root) => pathContains(root, targetPath))) return targetPath;
  throw new Error("Path is outside Fallback's trusted workspaces.");
}

function trustedShellRoots(services: TrustedShellPathServices): string[] {
  const settings = services.settings.get();
  const roots = new Set<string>([settings.workspacePath]);
  const repos =
    services.database.localCache?.repos.listWatchedReposForActiveAccount() ?? services.database.listWatchedReposForActiveAccount?.() ?? [];
  for (const repo of repos) {
    if (repo.localPath) roots.add(repo.localPath);
    const workspaces =
      services.database.localCache?.repoWorkspaces.listRepoWorkspaces(repo.id) ?? services.database.listRepoWorkspaces?.(repo.id) ?? [];
    for (const workspace of workspaces) roots.add(workspace.localPath);
  }
  return [...roots].map(canonicalPath);
}

function pathContains(root: string, candidate: string): boolean {
  const canonicalRoot = canonicalPath(root);
  const canonicalCandidate = canonicalPath(candidate);
  return canonicalCandidate === canonicalRoot || canonicalCandidate.startsWith(`${canonicalRoot}${path.sep}`);
}

function canonicalPath(value: string): string {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}
