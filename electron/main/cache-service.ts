import fs from "node:fs";
import { arch, platform, release } from "node:os";
import type { CacheSummary, DiagnosticsExport } from "../../src/shared/domain/cache.js";
import { fallbackAppVersion } from "./build-config.generated.js";
import { DatabaseService } from "./database-service.js";
import { nowIso } from "./path-utils.js";
import { SettingsService } from "./settings-service.js";
import { WorkspaceService } from "./workspace-service.js";

const cacheSummaryDetailedTtlMs = 60_000;
const cacheSummaryTtlMs = 15_000;

export class CacheService {
  private summaryCache: { value: CacheSummary; expiresAt: number } | null = null;
  private detailedSummaryCache: { value: CacheSummary; expiresAt: number } | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly settings: SettingsService,
    private readonly workspace: WorkspaceService
  ) {}

  summary(): CacheSummary {
    if (this.summaryCache && this.summaryCache.expiresAt > Date.now()) return this.summaryCache.value;
    const { workspacePath } = this.settings.get();
    const databasePath = this.settings.databasePath();
    const value = this.database.localCache.cacheSummary.cacheSummary(workspacePath, databasePath);
    this.database.localCache.cacheSummary.upsertCacheSummarySnapshot(value);
    this.summaryCache = { value, expiresAt: Date.now() + cacheSummaryTtlMs };
    return value;
  }

  summarySnapshot(): CacheSummary | null {
    if (this.summaryCache && this.summaryCache.expiresAt > Date.now()) return this.summaryCache.value;
    const { workspacePath } = this.settings.get();
    const databasePath = this.settings.databasePath();
    const snapshot = this.database.localCache.cacheSummary.cacheSummarySnapshot(workspacePath, databasePath);
    if (snapshot) this.summaryCache = { value: snapshot, expiresAt: Date.now() + cacheSummaryTtlMs };
    return snapshot;
  }

  summaryDetailed(): CacheSummary {
    if (this.detailedSummaryCache && this.detailedSummaryCache.expiresAt > Date.now()) return this.detailedSummaryCache.value;
    const startedAt = performance.now();
    const { workspacePath } = this.settings.get();
    const value = this.database.localCache.cacheSummary.cacheSummary(workspacePath, this.settings.databasePath(), {
      includeLocalBytes: true
    });
    this.database.localCache.cacheSummary.upsertCacheSummarySnapshot(value);
    this.summaryCache = { value, expiresAt: Date.now() + cacheSummaryTtlMs };
    this.detailedSummaryCache = { value, expiresAt: Date.now() + cacheSummaryDetailedTtlMs };
    logCacheTiming("summaryDetailed", startedAt, { repos: value.repos.length });
    return value;
  }

  deleteRepo(repoId: string): CacheSummary {
    const repo = this.database.localCache.repos.getRepo(repoId);
    this.database.localCache.cacheSummary.deleteRepoCache(repoId);
    if (repo) this.workspace.removeManagedRepoFolders([repo]);
    this.summaryCache = null;
    this.detailedSummaryCache = null;
    return this.refreshSummarySnapshot();
  }

  invalidateSummary(): void {
    this.summaryCache = null;
    this.detailedSummaryCache = null;
  }

  deleteAll(): CacheSummary {
    const repos = this.database.localCache.repos.listWatchedRepos();
    this.database.localCache.cacheSummary.deleteAllCache();
    this.workspace.removeManagedRepoFolders(repos);
    this.summaryCache = null;
    this.detailedSummaryCache = null;
    return this.refreshSummarySnapshot();
  }

  exportDiagnostics(includeSensitive = false): DiagnosticsExport {
    const startedAt = performance.now();
    const createdAt = nowIso();
    const path = this.workspace.diagnosticsPath(`diagnostics-${createdAt.replaceAll(/[:.]/g, "-")}.json`);
    const payload = {
      app: {
        name: "Fallback",
        version: fallbackAppVersion,
        platform: platform(),
        arch: arch(),
        release: release()
      },
      createdAt,
      redacted: !includeSensitive,
      workspace: this.workspaceDiagnostics(includeSensitive),
      cache: this.diagnosticsCache(includeSensitive),
      schemaVersion: this.database.localCache.appMetadata.schemaVersion(),
      syncJobs: this.database.localCache.syncJobs.syncJobDiagnostics(),
      rateLimit: this.database.localCache.syncJobs.latestRateLimit(),
      health: this.database.localCache.diagnostics.healthDiagnostics(),
      events: this.database.localCache.diagnostics.diagnosticEvents(),
      credentialChecks: this.credentialDiagnostics(includeSensitive),
      repoSigning: this.signingDiagnostics(includeSensitive),
      recoveryRecords: this.recoveryDiagnostics(includeSensitive)
    };

    fs.writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
    logCacheTiming("exportDiagnostics", startedAt, { repos: payload.cache.repos.length, includeSensitive: includeSensitive ? 1 : 0 });
    return { path, createdAt, redacted: !includeSensitive };
  }

  private diagnosticsCache(includeSensitive: boolean): CacheSummary {
    const summary = this.summaryDetailed();
    if (includeSensitive) return summary;
    return {
      ...summary,
      workspacePath: "[redacted]",
      databasePath: "[redacted]",
      repos: summary.repos.map((repo, index) => ({
        repoId: `repo-${index + 1}`,
        repoFullName: `repo-${index + 1}`,
        estimatedBytes: repo.estimatedBytes,
        localBytes: repo.localBytes,
        rows: repo.rows
      }))
    };
  }

  private workspaceDiagnostics(includeSensitive: boolean): ReturnType<SettingsService["diagnostics"]> {
    const diagnostics = this.settings.diagnostics();
    if (includeSensitive) return diagnostics;
    return {
      ...diagnostics,
      workspacePath: "[redacted]",
      configPath: "[redacted]",
      workspacePointerPath: diagnostics.workspacePointerPath ? "[redacted]" : null
    };
  }

  private refreshSummarySnapshot(): CacheSummary {
    const { workspacePath } = this.settings.get();
    const value = this.database.localCache.cacheSummary.cacheSummary(workspacePath, this.settings.databasePath());
    this.database.localCache.cacheSummary.upsertCacheSummarySnapshot(value);
    this.summaryCache = { value, expiresAt: Date.now() + cacheSummaryTtlMs };
    return value;
  }

  private credentialDiagnostics(
    includeSensitive: boolean
  ): Array<{ level: string; code: string; message: string | null; createdAt: string }> {
    const events = this.database.localCache.diagnostics.credentialDiagnosticEvents();
    if (includeSensitive) return events;
    const repos = this.database.localCache.repos.listWatchedRepos();
    return events.map((event) => {
      let message = event.message;
      repos.forEach((repo, index) => {
        const replacement = `repo-${index + 1}`;
        const identifiers = [repo.id, repo.fullName].sort((left, right) => right.length - left.length);
        identifiers.forEach((identifier) => {
          message = message?.replaceAll(identifier, replacement) ?? null;
        });
      });
      return { ...event, message };
    });
  }

  private recoveryDiagnostics(
    includeSensitive: boolean
  ): ReturnType<DatabaseService["localCache"]["diagnostics"]["operationRecoveryDiagnostics"]> {
    const records = this.database.localCache.diagnostics.operationRecoveryDiagnostics();
    if (includeSensitive) return records;
    const repos = this.database.localCache.repos.listWatchedRepos();
    return records.map((record) => {
      const index = repos.findIndex((repo) => repo.id === record.repoId || repo.fullName === record.repoFullName);
      const replacement = index >= 0 ? `repo-${index + 1}` : null;
      const redactWorkspace = (value: string | null) => {
        let redacted = redactCredentialsInUrls(redactRepoIdentifiers(value, repos));
        if (record.workspacePath) redacted = redactLiteral(redacted, record.workspacePath, "[redacted-workspace]");
        if (record.workspaceBranch) redacted = redactLiteral(redacted, record.workspaceBranch, "[redacted-branch]");
        return redacted;
      };
      return {
        ...record,
        repoId: replacement,
        repoFullName: replacement,
        workspaceId: record.workspaceId ? "[redacted]" : null,
        workspacePath: record.workspacePath ? "[redacted]" : null,
        workspaceBranch: record.workspaceBranch ? "[redacted-branch]" : null,
        commandSummary: redactWorkspace(record.commandSummary),
        recoveryHint: redactWorkspace(record.recoveryHint),
        recoveryReflogHint: redactWorkspace(record.recoveryReflogHint),
        recoveryBranch: record.recoveryBranch ? "[redacted-branch]" : null
      };
    });
  }

  private signingDiagnostics(includeSensitive: boolean): Array<{
    repoId: string | null;
    repoFullName: string | null;
    signingMode: string;
    signingKeyConfigured: boolean;
    signingKeyHint: string | null;
  }> {
    const repos = this.database.localCache.repos.listWatchedRepos();
    return repos.map((repo, index) => {
      const identity = this.database.localCache.repoIdentities.getRepoIdentity(repo.id);
      const replacement = `repo-${index + 1}`;
      return {
        repoId: includeSensitive ? repo.id : replacement,
        repoFullName: includeSensitive ? repo.fullName : replacement,
        signingMode: identity?.signingMode ?? "unknown",
        signingKeyConfigured: Boolean(identity?.signingKeyHint),
        signingKeyHint: redactSigningHint(identity?.signingKeyHint ?? null)
      };
    });
  }
}

function redactRepoIdentifiers(value: string | null, repos: Array<{ id: string; fullName: string }>): string | null {
  let redacted = value;
  repos.forEach((repo, index) => {
    const replacement = `repo-${index + 1}`;
    const identifiers = [repo.id, repo.fullName].sort((left, right) => right.length - left.length);
    identifiers.forEach((identifier) => {
      redacted = redacted?.replaceAll(identifier, replacement) ?? null;
    });
  });
  return redacted;
}

function logCacheTiming(name: string, startedAt: number, details: Record<string, string | number> = {}): void {
  const durationMs = performance.now() - startedAt;
  if (durationMs < 100 && process.env.FALLBACK_PERF_SMOKE !== "1") return;
  const detailText = Object.entries(details)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.info(`[perf] cache ${name}: ${detailText ? `${detailText} ` : ""}total=${Math.round(durationMs)}ms`);
}

function redactLiteral(value: string | null, literal: string, replacement: string): string | null {
  return value?.replaceAll(literal, replacement) ?? null;
}

function redactCredentialsInUrls(value: string | null): string | null {
  return value?.replaceAll(/https:\/\/[^/@\s]+:[^/@\s]+@/g, "https://[redacted]@") ?? null;
}

function redactSigningHint(value: string | null): string | null {
  if (!value) return null;
  return "[configured]";
}
