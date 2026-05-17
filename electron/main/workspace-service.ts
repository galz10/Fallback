import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppSettings } from "../../src/shared/domain/settings.js";
import { nowIso } from "./path-utils.js";

const execFileAsync = promisify(execFile);
const remoteFetchLocks = new Map<string, Promise<void>>();

async function gitText(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 120_000 });
  return stdout.trim();
}

export class WorkspaceService {
  constructor(private readonly getSettings: () => AppSettings) {}

  ensureRepoFolder(owner: string, repo: string, mode: "metadata-only" | "cloned"): string {
    const settings = this.getSettings();
    const repoPath = this.repoPath(owner, repo);
    if (!settings.createRepoFoldersOnWatch) return repoPath;

    const existedBefore = fs.existsSync(repoPath);
    fs.mkdirSync(repoPath, { recursive: true });
    this.migrateRepoMetadata(owner, repo, mode);
    this.ensureRepoMarker(
      owner,
      repo,
      mode,
      existedBefore || !isDirectoryEmpty(repoPath) ? {} : { managedPath: repoPath, managedPathCreatedAt: nowIso() }
    );

    return repoPath;
  }

  async ensureRepoClone(owner: string, repo: string, cloneUrl: string | null | undefined, defaultBranch?: string | null): Promise<string> {
    const repoPath = this.repoPath(owner, repo);
    if (fs.existsSync(path.join(repoPath, ".git"))) {
      this.ensureRepoMarker(owner, repo, "cloned");
      await this.refreshRepoRemoteState(repoPath, defaultBranch);
      await this.fastForwardCurrentBranch(repoPath, defaultBranch);
      return repoPath;
    }

    this.prepareCloneTarget(owner, repo, repoPath);
    fs.mkdirSync(path.dirname(repoPath), { recursive: true });
    await execFileAsync("git", ["clone", "--quiet", cloneUrl ?? `https://github.com/${owner}/${repo}.git`, repoPath], { timeout: 300_000 });
    this.ensureRepoMarker(owner, repo, "cloned", { managedPath: repoPath, managedPathCreatedAt: nowIso() });
    return repoPath;
  }

  async refreshRepoRemoteState(repoPath: string, defaultBranch?: string | null): Promise<void> {
    if (!fs.existsSync(path.join(repoPath, ".git"))) return;
    await withRemoteFetchLock(repoPath, async () => {
      await fetchOriginWithRemoteRefRecovery(repoPath);
      await this.fetchRemoteBranch(repoPath, defaultBranch);
    });
  }

  private async fetchRemoteBranch(repoPath: string, branch?: string | null): Promise<void> {
    const cleanBranch = branch?.trim();
    if (!cleanBranch) return;
    await execFileAsync("git", ["-C", repoPath, "fetch", "--quiet", "origin", `${cleanBranch}:refs/remotes/origin/${cleanBranch}`], {
      timeout: 120_000
    }).catch((error) => {
      console.warn(`Fetched ${repoPath}, but could not refresh origin/${cleanBranch}.`, error);
    });
  }

  private async fastForwardCurrentBranch(repoPath: string, defaultBranch?: string | null): Promise<void> {
    const branch = await gitText(repoPath, ["branch", "--show-current"]).catch(() => "");
    if (!branch) return;

    const dirty = await gitText(repoPath, ["status", "--porcelain=v1"]).catch(() => "");
    if (dirty.trim()) return;

    let upstream = await gitText(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).catch(() => "");
    if (!upstream && branch === defaultBranch) {
      upstream = await gitText(repoPath, ["rev-parse", "--verify", "--quiet", `origin/${branch}`])
        .then(() => `origin/${branch}`)
        .catch(() => "");
    }
    if (!upstream) return;

    await execFileAsync("git", ["-C", repoPath, "merge", "--ff-only", "--quiet", upstream], { timeout: 120_000 }).catch((error) => {
      console.warn(`Fetched ${repoPath}, but could not fast-forward ${branch} from ${upstream}.`, error);
    });
  }

  updateRepoMarker(owner: string, repo: string, patch: Record<string, unknown>): void {
    this.migrateRepoMetadata(owner, repo);
    const markerPath = this.repoMarkerPath(owner, repo);
    if (!fs.existsSync(markerPath)) this.ensureRepoMarker(owner, repo, "metadata-only");

    const current = JSON.parse(fs.readFileSync(markerPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(markerPath, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`);
  }

  migrateWatchedRepoMetadata(
    repos: Array<{
      owner: string;
      name: string;
      localPath?: string | null;
      watchMode?: "metadata-only" | "cloned" | null;
      lastSuccessfulSyncAt?: string | null;
    }>
  ): void {
    for (const repo of repos) {
      this.migrateRepoMetadata(repo.owner, repo.name, repo.watchMode ?? "metadata-only", repo.localPath ? [repo.localPath] : []);
      this.ensureRepoMarker(repo.owner, repo.name, repo.watchMode ?? "metadata-only", {
        lastSyncedAt: repo.lastSuccessfulSyncAt ?? null
      });
    }
  }

  migrateLegacyRepoMetadataTree(): void {
    const workspacePath = this.getSettings().workspacePath;
    const appMetadataPath = path.join(workspacePath, ".fallback");
    if (!fs.existsSync(workspacePath)) return;

    for (const legacyPath of this.findLegacyRepoMetadataPaths(workspacePath, appMetadataPath)) {
      const legacyMarkerPath = path.join(legacyPath, "repo.json");
      try {
        const marker = JSON.parse(fs.readFileSync(legacyMarkerPath, "utf8")) as { owner?: unknown; repo?: unknown; mode?: unknown };
        const owner = typeof marker.owner === "string" ? marker.owner : null;
        const repo = typeof marker.repo === "string" ? marker.repo : null;
        if (owner && repo) {
          const markerPath = this.repoMarkerPath(owner, repo);
          if (!fs.existsSync(markerPath)) {
            fs.mkdirSync(path.dirname(markerPath), { recursive: true });
            fs.copyFileSync(legacyMarkerPath, markerPath);
          }
          this.ensureRepoMarker(owner, repo, marker.mode === "cloned" ? "cloned" : "metadata-only", marker as Record<string, unknown>);
        }
        fs.rmSync(legacyPath, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Failed to migrate legacy repo metadata at ${legacyPath}`, error);
      }
    }
  }

  removeRepoFolder(owner: string, repo: string): void {
    this.removeManagedRepoFolders([{ owner, name: repo, localPath: this.repoPath(owner, repo) }]);
  }

  removeManagedRepoFolders(repos: Array<{ owner: string; name: string; localPath?: string | null }>): void {
    const workspacePath = path.resolve(this.getSettings().workspacePath);
    const removed = new Set<string>();
    for (const repo of repos) {
      for (const targetPath of this.managedRepoFolderCandidates(repo.owner, repo.name, repo.localPath)) {
        const resolved = path.resolve(targetPath);
        if (removed.has(resolved)) continue;
        if (!pathContains(workspacePath, resolved)) continue;
        if (!fs.existsSync(resolved)) continue;
        if (!this.canRemoveRepoFolder(repo.owner, repo.name, resolved)) continue;
        fs.rmSync(resolved, { recursive: true, force: true });
        removed.add(resolved);
        this.pruneEmptyParents(path.dirname(resolved), workspacePath);
      }
    }
    this.pruneEmptyParents(path.join(workspacePath, "github.com"), workspacePath);
  }

  diagnosticsPath(fileName: string): string {
    const logsPath = path.join(this.getSettings().workspacePath, ".fallback", "logs");
    fs.mkdirSync(logsPath, { recursive: true });
    return path.join(logsPath, fileName);
  }

  repoPath(owner: string, repo: string): string {
    return path.join(this.getSettings().workspacePath, owner, repo);
  }

  private repoMarkerPath(owner: string, repo: string): string {
    return path.join(this.getSettings().workspacePath, ".fallback", "repos", "github.com", owner, `${repo}.json`);
  }

  private legacyRepoMetadataPath(owner: string, repo: string): string {
    return path.join(this.repoPath(owner, repo), ".fallback");
  }

  private migrateRepoMetadata(
    owner: string,
    repo: string,
    mode: "metadata-only" | "cloned" = "metadata-only",
    extraRepoPaths: string[] = []
  ): void {
    const markerPath = this.repoMarkerPath(owner, repo);

    for (const legacyPath of this.legacyRepoMetadataPaths(owner, repo, extraRepoPaths)) {
      const legacyMarkerPath = path.join(legacyPath, "repo.json");
      if (fs.existsSync(legacyMarkerPath) && !fs.existsSync(markerPath)) {
        fs.mkdirSync(path.dirname(markerPath), { recursive: true });
        fs.copyFileSync(legacyMarkerPath, markerPath);
      }

      if (fs.existsSync(legacyPath)) {
        fs.rmSync(legacyPath, { recursive: true, force: true });
      }
    }

    this.ensureRepoMarker(owner, repo, mode);
  }

  private legacyRepoMetadataPaths(owner: string, repo: string, extraRepoPaths: string[]): string[] {
    const paths = [
      this.legacyRepoMetadataPath(owner, repo),
      path.join(this.getSettings().workspacePath, "github.com", owner, repo, ".fallback"),
      ...extraRepoPaths.map((repoPath) => path.join(repoPath, ".fallback"))
    ];
    return [...new Set(paths)];
  }

  private findLegacyRepoMetadataPaths(root: string, appMetadataPath: string): string[] {
    const results: string[] = [];
    const visit = (dir: string): void => {
      if (path.resolve(dir) === path.resolve(appMetadataPath)) return;
      const markerPath = path.join(dir, ".fallback", "repo.json");
      if (fs.existsSync(markerPath)) {
        results.push(path.join(dir, ".fallback"));
        return;
      }

      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === ".git" || entry.name === "node_modules") continue;
        visit(path.join(dir, entry.name));
      }
    };
    visit(root);
    return results;
  }

  private ensureRepoMarker(owner: string, repo: string, mode: "metadata-only" | "cloned", patch: Record<string, unknown> = {}): void {
    const markerPath = this.repoMarkerPath(owner, repo);
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });

    const existing = fs.existsSync(markerPath) ? (JSON.parse(fs.readFileSync(markerPath, "utf8")) as Record<string, unknown>) : {};
    fs.writeFileSync(
      markerPath,
      `${JSON.stringify(
        {
          provider: "github.com",
          owner,
          repo,
          fullName: `${owner}/${repo}`,
          mode,
          watchedAt: existing.watchedAt ?? nowIso(),
          lastSyncedAt: null,
          ...existing,
          ...patch
        },
        null,
        2
      )}\n`
    );
  }

  private prepareCloneTarget(owner: string, repo: string, repoPath: string): void {
    if (!fs.existsSync(repoPath)) return;
    const stat = fs.lstatSync(repoPath);
    if (!stat.isDirectory()) throw new Error(`Cannot clone ${owner}/${repo}: ${repoPath} already exists and is not a folder.`);
    if (isDirectoryEmpty(repoPath)) return;
    if (this.isExplicitlyManagedRepoPath(owner, repo, repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
      return;
    }
    throw new Error(
      `Cannot clone ${owner}/${repo}: ${repoPath} already exists and is not managed by Fallback. Move or empty that folder before cloning.`
    );
  }

  private managedRepoFolderCandidates(owner: string, repo: string, localPath?: string | null): string[] {
    const candidates = new Set<string>();
    const marker = this.readRepoMarker(owner, repo);
    const managedPath = typeof marker?.managedPath === "string" ? marker.managedPath : null;
    if (managedPath) candidates.add(managedPath);
    if (localPath) candidates.add(localPath);
    candidates.add(this.repoPath(owner, repo));
    candidates.add(path.join(this.getSettings().workspacePath, "github.com", owner, repo));
    return [...candidates];
  }

  private canRemoveRepoFolder(owner: string, repo: string, targetPath: string): boolean {
    if (this.isExplicitlyManagedRepoPath(owner, repo, targetPath)) return true;
    const expectedCurrentPath = this.repoPath(owner, repo);
    const expectedLegacyPath = path.join(this.getSettings().workspacePath, "github.com", owner, repo);
    return (
      (pathsEqual(targetPath, expectedCurrentPath) || pathsEqual(targetPath, expectedLegacyPath)) &&
      fs.existsSync(path.join(targetPath, ".git"))
    );
  }

  private isExplicitlyManagedRepoPath(owner: string, repo: string, targetPath: string): boolean {
    const marker = this.readRepoMarker(owner, repo);
    const managedPath = typeof marker?.managedPath === "string" ? marker.managedPath : null;
    return Boolean(managedPath && pathsEqual(managedPath, targetPath));
  }

  private readRepoMarker(owner: string, repo: string): Record<string, unknown> | null {
    const markerPath = this.repoMarkerPath(owner, repo);
    if (!fs.existsSync(markerPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(markerPath, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private pruneEmptyParents(startPath: string, stopPath: string): void {
    let current = path.resolve(startPath);
    const stop = path.resolve(stopPath);
    while (current !== stop && pathContains(stop, current) && fs.existsSync(current)) {
      if (!isDirectoryEmpty(current)) return;
      fs.rmdirSync(current);
      current = path.dirname(current);
    }
  }
}

async function withRemoteFetchLock(repoPath: string, task: () => Promise<void>): Promise<void> {
  const previous = remoteFetchLocks.get(repoPath);
  if (previous) await previous.catch(() => undefined);
  const current = task();
  remoteFetchLocks.set(repoPath, current);
  try {
    await current;
  } finally {
    if (remoteFetchLocks.get(repoPath) === current) remoteFetchLocks.delete(repoPath);
  }
}

async function fetchOriginWithRemoteRefRecovery(repoPath: string): Promise<void> {
  try {
    await execFileAsync("git", ["-C", repoPath, "fetch", "--quiet", "--prune", "origin"], { timeout: 120_000 });
  } catch (error) {
    const staleRefs = remoteTrackingRefsFromFetchError(error);
    if (staleRefs.length === 0) throw error;
    for (const ref of staleRefs) {
      await execFileAsync("git", ["-C", repoPath, "update-ref", "-d", ref], { timeout: 30_000 }).catch(() => undefined);
    }
    await execFileAsync("git", ["-C", repoPath, "fetch", "--quiet", "--prune", "origin"], { timeout: 120_000 });
  }
}

function remoteTrackingRefsFromFetchError(error: unknown): string[] {
  const text = errorText(error);
  const refs = new Set<string>();
  const pattern = /cannot lock ref '([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const ref = match[1];
    if (ref?.startsWith("refs/remotes/origin/")) refs.add(ref);
  }
  return [...refs];
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
    return `${error.message}\n${stderr}`;
  }
  return String(error);
}

function isDirectoryEmpty(value: string): boolean {
  try {
    return fs.readdirSync(value).length === 0;
  } catch {
    return false;
  }
}

function pathsEqual(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right);
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
