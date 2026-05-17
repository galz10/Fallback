import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logStartupMeasure, markStartup, logStartupSinceStart } from "../performance.js";
import type { FallbackWindowContext } from "../../../src/shared/domain/window-context.js";
import { isAllowedRendererNavigation, type MainWindowLoadTarget } from "./navigation-guards.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createMainWindow(_context?: FallbackWindowContext): BrowserWindow {
  markStartup("window:create:start");
  const preload = path.join(__dirname, "../../preload/index.js");
  markStartup("window:constructor:start");
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    title: "Fallback",
    frame: false,
    backgroundColor: "#000000",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  markStartup("window:constructor:end");

  const loadTarget = mainWindowLoadTarget();
  installNavigationGuards(win, loadTarget);

  markStartup("renderer:load:start");
  if (loadTarget.kind === "file") void win.loadFile(loadTarget.value);
  else void win.loadURL(loadTarget.value);

  win.webContents.once("did-finish-load", () => {
    markStartup("renderer:did-finish-load");
    logStartupSinceStart("process to renderer did-finish-load", "renderer:did-finish-load");
    logStartupMeasure("post-usable did-finish-load delay", "renderer:first-usable", "renderer:did-finish-load");
  });
  markStartup("window:create:end");
  logStartupSinceStart("process to BrowserWindow created", "window:create:end");

  return win;
}

export function mainWindowLoadTarget(): MainWindowLoadTarget {
  if (process.env.FALLBACK_LOAD_PRODUCTION === "1") return { kind: "file", value: packagedIndexPath() };
  if (process.env.VITE_DEV_SERVER_URL) return { kind: "url", value: process.env.VITE_DEV_SERVER_URL };
  if (app.isPackaged) return { kind: "file", value: packagedIndexPath() };
  return { kind: "url", value: "http://127.0.0.1:5173" };
}

function installNavigationGuards(win: BrowserWindow, loadTarget: MainWindowLoadTarget): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalHttps(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isAllowedRendererNavigation(url, loadTarget)) return;
    event.preventDefault();
    void openExternalHttps(url);
  });
}

async function openExternalHttps(url: string): Promise<void> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") await shell.openExternal(parsed.toString());
  } catch {
    // Invalid or non-HTTPS renderer navigation is intentionally inert.
  }
}

function packagedIndexPath(): string {
  return path.join(__dirname, "../../../../dist/index.html");
}
