import { app, BrowserWindow, Menu, ipcMain } from "electron";
import { ipcChannels } from "../../../src/shared/ipc.js";
import type { AppServices } from "../app-services.js";
import type { HealthChecks } from "./health-checks.js";
import type { ProtocolClient } from "../shell/protocol-client.js";
import { focusMainWindow, type CreateWindow } from "../shell/window-actions.js";
import {
  logStartupBudget,
  logStartupMeasure,
  logStartupSinceStart,
  logStartupTimeline,
  markStartup,
  shouldLogPerformance,
  startupMarkMs
} from "../performance.js";
import type { RendererReadyMetrics } from "../../../src/shared/contracts/fallback-api.js";

const postUsableBackgroundStartDelayMs = 350;

export interface LifecycleOptions {
  services: AppServices;
  createWindow: CreateWindow;
  createInitialWindows?: () => BrowserWindow;
  prepareForQuit?: () => void;
  healthChecks: HealthChecks;
  protocolClient: ProtocolClient;
  registerIpcHandlers(): void;
}

export function wireAppLifecycle(options: LifecycleOptions): void {
  const { services, createWindow, createInitialWindows, prepareForQuit, healthChecks, protocolClient, registerIpcHandlers } = options;
  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  let backgroundStarted = false;

  if (!hasSingleInstanceLock) {
    app.quit();
    return;
  }

  app.on("second-instance", (_event, argv) => {
    protocolClient.handleUrlFromArgv(argv);
    focusMainWindow(createWindow);
  });

  const startBackgroundServices = () => {
    if (backgroundStarted) return;
    backgroundStarted = true;
    markStartup("background:start");
    logStartupMeasure("post-usable background start delay", "renderer:first-usable", "background:start");
    services.runDeferredStartupWork();
    services.scheduler.start();
    services.appUpdate.start();
    healthChecks.start();
    logStartupTimeline();
  };

  app.whenReady().then(() => {
    markStartup("app:ready");
    Menu.setApplicationMenu(null);
    protocolClient.register();
    registerIpcHandlers();
    const window = createInitialWindows ? createInitialWindows() : createWindow();
    markStartup("window:created");
    ipcMain.once(ipcChannels.performanceRendererReady, (_event, metrics?: RendererReadyMetrics) => {
      markStartup("renderer:first-usable");
      logRendererReadyReceived(metrics);
      logStartupSinceStart("startup critical path process to first usable", "renderer:first-usable");
      logStartupMeasure("startup critical path window created to first usable", "window:created", "renderer:first-usable");
      logStartupBudget(
        "process to first usable",
        "process:start",
        "renderer:first-usable",
        app.isPackaged || process.env.FALLBACK_LOAD_PRODUCTION === "1" ? 250 : 400
      );
      logStartupBudget("window created to first usable", "window:created", "renderer:first-usable", 200);
      logRendererReadyMetrics(metrics);
      void runPerfSmoke(window);
      setTimeout(startBackgroundServices, postUsableBackgroundStartDelayMs);
    });
    window.webContents.once("did-finish-load", () => {
      setTimeout(startBackgroundServices, 5_000);
    });
    protocolClient.handleUrlFromArgv(process.argv);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    void protocolClient.handleOAuthCallbackUrl(url);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    prepareForQuit?.();
    services.appUpdate.stop();
    services.scheduler.stop();
    healthChecks.stop();
    services.localGit.dispose();
    services.database.close();
  });
}

async function runPerfSmoke(window: BrowserWindow): Promise<void> {
  if (process.env.FALLBACK_PERF_SMOKE !== "1") return;
  try {
    const delay = await window.webContents.executeJavaScript(
      `new Promise((resolve) => {
        const startedAt = performance.now();
        requestAnimationFrame(() => setTimeout(() => resolve(Math.round(performance.now() - startedAt)), 0));
      })`,
      true
    );
    console.info(`[perf] first interaction delay: ${Number(delay)}ms`);
  } catch (error) {
    console.warn("[perf] first interaction delay failed", error);
  } finally {
    setTimeout(() => app.quit(), 1_500);
  }
}

function logRendererReadyMetrics(metrics: RendererReadyMetrics | undefined): void {
  if (!shouldLogPerformance()) return;
  if (!metrics) return;
  const entries: Array<[string, number | undefined]> = [
    ["html:inline-script", metrics.htmlScriptMs],
    ["module-graph-loaded", metrics.moduleLoadedMs],
    ["root-render-called", metrics.rootRenderCalledMs],
    ["shell-paint", metrics.shellPaintMs],
    ["renderer-ready-sent", metrics.rendererReadySentMs],
    ["ready-effect", metrics.readyEffectMs],
    ["dom-interactive", metrics.domInteractiveMs],
    ["dom-content-loaded", metrics.domContentLoadedMs],
    ["load-event-end", metrics.loadEventEndMs]
  ];
  console.info(
    `[perf] renderer startup ${entries
      .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
      .map(([name, value]) => `${name}=${Math.round(value)}ms`)
      .join(" ")}`
  );
  if (metrics.entryImports?.length) {
    console.info(`[perf] renderer entry imports ${metrics.entryImports.join(" ")}`);
  }
}

function logRendererReadyReceived(metrics: RendererReadyMetrics | undefined): void {
  if (!shouldLogPerformance()) return;
  const receivedAt = startupMarkMs("renderer:first-usable");
  const startAt = startupMarkMs("process:start");
  const mainSinceStart = receivedAt != null && startAt != null ? Math.round(receivedAt - startAt) : null;
  const sent = metrics?.rendererReadySentMs;
  const transitMs = Number.isFinite(metrics?.rendererReadyEpochMs) ? Math.max(0, Date.now() - metrics!.rendererReadyEpochMs!) : null;
  const sentCopy = Number.isFinite(sent) ? ` renderer-ready-sent=${Math.round(sent!)}ms` : "";
  const transitCopy = transitMs == null ? "" : ` renderer-ready-transit=${Math.round(transitMs)}ms`;
  const mainCopy = mainSinceStart == null ? "" : ` main-since-start=${mainSinceStart}ms`;
  console.info(`[perf] renderer ready IPC received${mainCopy}${sentCopy}${transitCopy}`);
}
