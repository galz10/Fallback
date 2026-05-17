import { createRequire } from "node:module";
import type { AppUpdater, ProgressInfo, UpdateInfo } from "electron-updater";
import type { AppUpdateActionResult, AppUpdateCheckResult, AppUpdateState } from "../../src/shared/domain/app-update.js";
import { bundledFallbackUpdateRepository, fallbackAppVersion } from "./build-config.generated.js";

const require = createRequire(import.meta.url);
const electronUpdater = require("electron-updater") as typeof import("electron-updater");
const defaultCheckIntervalMs = 6 * 60 * 60 * 1000;
const defaultStartupDelayMs = 30_000;

type UpdateRepository = {
  owner: string;
  repo: string;
};

type UpdaterEvents = Pick<AppUpdater, "on">;

export interface AppUpdateServiceOptions {
  updater?: AppUpdater;
  updateRepository?: string;
  currentVersion?: string;
  isPackaged?: boolean;
  env?: NodeJS.ProcessEnv;
  checkIntervalMs?: number;
  startupDelayMs?: number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  now?: () => string;
}

const disabledState: AppUpdateState = {
  enabled: false,
  status: "disabled",
  currentVersion: fallbackAppVersion,
  availableVersion: null,
  downloadedVersion: null,
  downloadPercent: null,
  checkedAt: null,
  message: "App updates are not configured for this build.",
  releaseName: null,
  releaseNotes: null,
  releaseDate: null
};

export class AppUpdateService {
  private readonly repository: UpdateRepository | null;
  private readonly updater: AppUpdater | null;
  private readonly checkIntervalMs: number;
  private readonly startupDelayMs: number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly now: () => string;
  private state: AppUpdateState;
  private started = false;
  private nextCheckTimer: NodeJS.Timeout | null = null;
  private checking = false;

  constructor(
    private readonly notifyChanged: () => void = () => undefined,
    options: AppUpdateServiceOptions = {}
  ) {
    const env = options.env ?? process.env;
    const currentVersion = options.currentVersion ?? fallbackAppVersion;
    const updateRepository = options.updateRepository ?? bundledFallbackUpdateRepository;
    const isPackaged = options.isPackaged ?? defaultIsPackaged();
    this.repository = parseUpdateRepository(updateRepository);
    this.checkIntervalMs = options.checkIntervalMs ?? defaultCheckIntervalMs;
    this.startupDelayMs = options.startupDelayMs ?? defaultStartupDelayMs;
    this.setTimer = options.setTimeout ?? setTimeout;
    this.clearTimer = options.clearTimeout ?? clearTimeout;
    this.now = options.now ?? nowIso;

    const disabledMessage = disabledReason({ env, isPackaged, updateRepository, repository: this.repository });
    if (disabledMessage) {
      this.updater = null;
      this.state = { ...disabledState, currentVersion, message: disabledMessage };
      return;
    }

    const repository = this.repository;
    if (!repository) throw new Error("App update repository was unexpectedly unavailable.");
    const updater = options.updater ?? electronUpdater.autoUpdater;
    this.updater = updater;
    this.state = { ...disabledState, enabled: true, status: "idle", currentVersion, message: null };

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.channel = "latest";
    updater.setFeedURL({ provider: "github", owner: repository.owner, repo: repository.repo });

    this.onUpdater(updater, "checking-for-update", () => this.patchState({ status: "checking", message: null, downloadPercent: null }));
    this.onUpdater(updater, "update-available", (info: UpdateInfo) => {
      this.applyUpdateInfo(info);
      this.patchState({ status: "available", message: null, checkedAt: this.now(), downloadPercent: null });
    });
    this.onUpdater(updater, "update-not-available", (info: UpdateInfo) => {
      this.applyUpdateInfo(info);
      this.patchState({ status: "idle", message: "No update available.", checkedAt: this.now(), downloadPercent: null });
    });
    this.onUpdater(updater, "download-progress", (progress: ProgressInfo) => this.patchDownloadProgress(progress));
    this.onUpdater(updater, "update-downloaded", (info: UpdateInfo) => {
      this.applyUpdateInfo(info);
      this.patchState({
        status: "downloaded",
        downloadedVersion: info.version,
        message: null,
        downloadPercent: 100
      });
    });
    this.onUpdater(updater, "error", (error: unknown) =>
      this.patchState({ status: "error", message: errorText(error), checkedAt: this.now() })
    );
  }

  getState(): AppUpdateState {
    return { ...this.state };
  }

  start(): void {
    if (this.started || !this.state.enabled || !this.updater) return;
    this.started = true;
    this.scheduleNextCheck(this.startupDelayMs);
  }

  stop(): void {
    this.started = false;
    if (!this.nextCheckTimer) return;
    this.clearTimer(this.nextCheckTimer);
    this.nextCheckTimer = null;
  }

  async check(): Promise<AppUpdateCheckResult> {
    return this.checkForUpdates();
  }

  async checkForUpdates(): Promise<AppUpdateCheckResult> {
    if (!this.state.enabled || !this.updater) return { checked: false, state: this.getState() };
    if (this.checking) return { checked: false, state: this.getState() };

    this.checking = true;
    this.patchState({ status: "checking", message: null, downloadPercent: null });
    try {
      const result = await this.updater.checkForUpdates();
      if (result?.updateInfo) this.applyUpdateInfo(result.updateInfo);
      if (this.state.status === "checking") {
        this.patchState({ status: "idle", message: "No update available.", checkedAt: this.now(), downloadPercent: null });
      }
      return { checked: true, state: this.getState() };
    } catch (error) {
      this.patchState({ status: "error", message: errorText(error), checkedAt: this.now() });
      return { checked: false, state: this.getState() };
    } finally {
      this.checking = false;
    }
  }

  async download(): Promise<AppUpdateActionResult> {
    if (!this.state.enabled || !this.updater || this.state.status !== "available") {
      return { accepted: false, completed: false, state: this.getState() };
    }

    this.patchState({ status: "downloading", message: null, downloadPercent: 0 });
    try {
      await this.updater.downloadUpdate();
      if (this.getState().status === "downloading") {
        this.patchState({ status: "downloaded", downloadedVersion: this.state.availableVersion, downloadPercent: 100 });
      }
      return { accepted: true, completed: true, state: this.getState() };
    } catch (error) {
      this.patchState({ status: "error", message: errorText(error) });
      return { accepted: true, completed: false, state: this.getState() };
    }
  }

  async install(): Promise<AppUpdateActionResult> {
    if (!this.state.enabled || !this.updater || this.state.status !== "downloaded") {
      return { accepted: false, completed: false, state: this.getState() };
    }

    setImmediate(() => this.updater?.quitAndInstall(false, true));
    return { accepted: true, completed: false, state: this.getState() };
  }

  private applyUpdateInfo(info: UpdateInfo): void {
    this.patchState({
      availableVersion: info.version ?? null,
      releaseName: info.releaseName ?? null,
      releaseNotes: releaseNotesText(info.releaseNotes),
      releaseDate: info.releaseDate ?? null
    });
  }

  private patchDownloadProgress(progress: ProgressInfo): void {
    this.patchState({ status: "downloading", downloadPercent: Math.max(0, Math.min(100, progress.percent)) });
  }

  private patchState(patch: Partial<AppUpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.notifyChanged();
  }

  private scheduleNextCheck(delayMs: number): void {
    if (!this.started || !this.state.enabled) return;
    if (this.nextCheckTimer) this.clearTimer(this.nextCheckTimer);
    this.nextCheckTimer = this.setTimer(
      () => {
        this.nextCheckTimer = null;
        void this.checkForUpdates().finally(() => {
          if (this.started) this.scheduleNextCheck(this.checkIntervalMs);
        });
      },
      Math.max(0, delayMs)
    );
  }

  private onUpdater<T extends unknown[]>(updater: UpdaterEvents, event: string, listener: (...args: T) => void): void {
    (updater.on as unknown as (event: string, listener: (...args: unknown[]) => void) => void)(event, (...args) =>
      listener(...(args as T))
    );
  }
}

export function parseUpdateRepository(value: string): UpdateRepository | null {
  const normalized = value
    .trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "");
  const [owner, repo, ...rest] = normalized.split("/").filter(Boolean);
  if (!owner || !repo || rest.length > 0) return null;
  return { owner, repo };
}

function disabledReason(input: {
  env: NodeJS.ProcessEnv;
  isPackaged: boolean;
  updateRepository: string;
  repository: UpdateRepository | null;
}): string | null {
  if (input.env.FALLBACK_DISABLE_UPDATES === "1" || input.env.FALLBACK_DISABLE_UPDATES === "true") {
    return "App updates are disabled by environment configuration.";
  }
  if (!input.isPackaged && input.env.FALLBACK_FORCE_UPDATES !== "1") {
    return "App updates are disabled in development builds.";
  }
  if (!input.updateRepository.trim()) {
    return "App updates are not configured for this build.";
  }
  if (!input.repository) {
    return "App updates are disabled because the update repository is invalid.";
  }
  return null;
}

function defaultIsPackaged(): boolean {
  try {
    const electron = require("electron") as { app?: { isPackaged?: boolean } };
    return Boolean(electron.app?.isPackaged);
  } catch {
    return false;
  }
}

function releaseNotesText(value: UpdateInfo["releaseNotes"]): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return (
    value
      .map((note) => [note.version, note.note].filter(Boolean).join("\n"))
      .filter(Boolean)
      .join("\n\n") || null
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
