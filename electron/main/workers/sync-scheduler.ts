import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { powerMonitor } from "electron";
import type { WatchedRepo } from "../../../src/shared/domain/watched-repo.js";
import type { SyncActiveContext } from "../../../src/shared/domain/sync.js";
import {
  isRepoRefreshDue,
  repoSyncPriority,
  repoSyncReason,
  syncCooldownMs,
  syncFreshnessMs,
  syncPriority
} from "../../../src/shared/sync-policy.js";
import { DatabaseService } from "../database-service.js";
import { SettingsService } from "../settings-service.js";
import { SyncService } from "../sync-service.js";

const gitStatusTimeoutMs = 5_000;
const gitStatusMaxBuffer = 1024 * 1024;

export class SyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly lastQueuedAt = new Map<string, number>();
  private readonly lastActiveSignalAt = new Map<string, number>();
  private readonly lastSkipDiagnosticAt = new Map<string, number>();
  private onBattery = false;

  private readonly setBattery = () => {
    this.onBattery = true;
  };

  private readonly setAc = () => {
    this.onBattery = false;
  };

  constructor(
    private readonly database: DatabaseService,
    private readonly sync: SyncService,
    private readonly settings: SettingsService,
    private readonly intervalMs = 60 * 1000
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }

    this.onBattery = powerMonitor.isOnBatteryPower();
    powerMonitor.on("on-battery", this.setBattery);
    powerMonitor.on("on-ac", this.setAc);
    this.timer = setInterval(() => {
      void this.refreshDueRepos();
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    powerMonitor.off("on-battery", this.setBattery);
    powerMonitor.off("on-ac", this.setAc);
    this.timer = null;
  }

  async setActiveContext(context: SyncActiveContext): Promise<void> {
    if (!context.visible) return;
    if (!context.online) {
      this.recordSkipDiagnostic(
        `active:${context.view}:offline`,
        "active_context_offline",
        `Skipped ${context.view} active sync signal while offline.`
      );
      return;
    }
    if (!this.hasConnectedGitHubAccount()) {
      this.recordSkipDiagnostic(
        `active:${context.view}:signed_out`,
        "active_context_signed_out",
        `Skipped ${context.view} active sync signal while GitHub is disconnected.`
      );
      return;
    }
    if (this.sync.isRateLimited()) {
      this.recordSkipDiagnostic(
        `active:${context.view}:rate_limited`,
        "active_context_rate_limited",
        `Skipped ${context.view} active sync signal while rate limited.`
      );
      return;
    }

    if (context.view === "My PRs" || context.view === "My Work") {
      void this.refreshUserPullRequests(Date.now(), true).catch(() => undefined);
      return;
    }

    if (!context.repoId) return;
    if (!this.database.localCache.repos.repoIsVisibleToAccount(context.repoId)) return;
    const repo = this.database.localCache.repos.getRepo(context.repoId);
    if (!repo) return;

    const detail = Boolean(context.prNumber || context.issueNumber);
    const ttl = detail ? syncFreshnessMs.activeDetail : syncFreshnessMs.activeRepo;
    const signalKey = `${context.repoId}:${context.view}:${context.prNumber ?? context.issueNumber ?? "repo"}`;
    const now = Date.now();
    if (now - (this.lastActiveSignalAt.get(signalKey) ?? 0) < 60_000) return;
    this.lastActiveSignalAt.set(signalKey, now);

    if (!isRepoRefreshDue(repo, ttl, now)) return;
    const priority = detail
      ? syncPriority.activeDetail
      : context.view === "Local Changes"
        ? syncPriority.localChanges
        : syncPriority.activeRepo;
    const reason = detail ? "active_detail" : context.view === "Local Changes" ? "local_changes" : "active_view";
    void this.sync
      .enqueueRepoSync(repo.id, "active_repo_sync", {
        priority,
        reason,
        dedupeKey: `${repo.id}:active_repo_sync`
      })
      .catch(() => undefined);
  }

  private async refreshDueRepos(jobType = "background_repo_sync"): Promise<void> {
    if (!this.hasConnectedGitHubAccount()) {
      this.recordSkipDiagnostic("scheduler:signed_out", "scheduler_signed_out", "Skipped background sync while GitHub is disconnected.");
      return;
    }
    if (this.sync.isRateLimited()) {
      this.recordSkipDiagnostic("scheduler:rate_limited", "scheduler_rate_limited", "Skipped background sync while rate limited.");
      return;
    }

    const now = Date.now();
    await this.refreshUserPullRequests(now);
    for (const repo of this.database.localCache.repos.listWatchedReposForActiveAccount()) {
      const lastQueuedAt = this.lastQueuedAt.get(repo.id) ?? 0;
      const interval = this.refreshInterval(repo.watchPriority);
      if (now - lastQueuedAt < interval) continue;
      if (!this.isDue(repo, now, interval)) continue;
      const cooldown = syncCooldownMs(repo.syncStatus);
      if (cooldown > 0 && now - timestamp(repo.lastSyncedAt) < cooldown) {
        const resumeAt = new Date(timestamp(repo.lastSyncedAt) + cooldown).toISOString();
        this.recordSkipDiagnostic(
          `${repo.id}:${repo.syncStatus}:cooldown`,
          `scheduler_${repo.syncStatus}_cooldown`,
          `Skipped ${repo.fullName} background sync during ${repo.syncStatus} cooldown until ${resumeAt}.`
        );
        continue;
      }
      this.lastQueuedAt.set(repo.id, now);
      const hasLocalChanges = await repoHasLocalChanges(repo);
      await this.sync.enqueueRepoSync(repo.id, jobType, {
        priority: repoSyncPriority(repo, { hasLocalChanges, now }),
        reason: repoSyncReason(repo, { hasLocalChanges, now }),
        dedupeKey: `${repo.id}:${jobType}`
      });
    }
  }

  private async refreshUserPullRequests(now: number, active = false): Promise<void> {
    const interval = this.refreshInterval(0);
    const lastSyncedAt = this.database.localCache.appMetadata.getAppMetadata("user_pull_requests_last_synced_at");
    const lastAttemptedAt = this.database.localCache.appMetadata.getAppMetadata("user_pull_requests_last_attempted_at");
    const lastSyncTime = Math.max(timestamp(lastSyncedAt), timestamp(lastAttemptedAt));
    const ttl = active ? syncFreshnessMs.myWork : interval;
    if (lastSyncTime > 0 && now - lastSyncTime < ttl) return;
    await this.sync.syncUserPullRequests();
  }

  private isDue(repo: WatchedRepo, now: number, interval: number): boolean {
    const lastSyncAt = repo.lastSuccessfulSyncAt ?? repo.lastSyncedAt;
    if (!lastSyncAt) return true;

    const lastSyncTime = Date.parse(lastSyncAt);
    if (!Number.isFinite(lastSyncTime)) return true;

    return now - lastSyncTime >= interval;
  }

  private refreshInterval(priority: number): number {
    const base = this.settings.get().syncFrequencyMinutes;
    const minutes = priority >= 10 ? Math.max(5, Math.round(base / 3)) : priority < 0 ? Math.max(base, 60) : base;
    return minutes * (this.onBattery ? 2 : 1) * 60 * 1000;
  }

  private recordSkipDiagnostic(key: string, code: string, message: string): void {
    const now = Date.now();
    if (now - (this.lastSkipDiagnosticAt.get(key) ?? 0) < 5 * 60_000) return;
    this.lastSkipDiagnosticAt.set(key, now);
    this.database.localCache.diagnostics.recordDiagnosticEvent({
      source: "sync",
      level: "info",
      code,
      message
    });
  }

  private hasConnectedGitHubAccount(): boolean {
    const account = this.database.localCache.accounts.getGitHubAccount();
    return Boolean(account?.tokenSource && account.authStatus === "connected");
  }
}

async function repoHasLocalChanges(repo: WatchedRepo): Promise<boolean> {
  if (repo.watchMode !== "cloned" || !repo.localPath || !existsSync(`${repo.localPath}/.git`)) return false;
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repo.localPath!, "status", "--porcelain=v1"],
      { encoding: "utf8", maxBuffer: gitStatusMaxBuffer, timeout: gitStatusTimeoutMs },
      (error, stdout) => {
        resolve(!error && stdout.trim().length > 0);
      }
    );
  });
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
