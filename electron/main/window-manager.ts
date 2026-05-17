import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  FallbackWindowContext,
  FallbackWindowContextInput,
  FallbackWindowRoute,
  FallbackWindowView
} from "../../src/shared/domain/window-context.js";
import type { AppServices } from "./app-services.js";
import { sendAppEvent } from "./ipc/app-events.js";
import { createMainWindow } from "./shell/create-main-window.js";

const windowContextsFileName = "window-contexts.json";
const maxRestoredWindows = 8;
const maxNavigationStack = 30;
const deferredWindowRestoreDelayMs = 1_500;
const validViews = new Set<FallbackWindowView>([
  "home",
  "My Work",
  "Code",
  "Local Changes",
  "Issues",
  "Pull requests",
  "Actions",
  "Branch Integrity",
  "Settings",
  "Status"
]);

export class WindowManager {
  private readonly contexts = new Map<number, FallbackWindowContext>();
  private quitting = false;
  private sequence = 0;

  constructor(private readonly services: AppServices) {}

  createWindow(input: FallbackWindowContextInput = {}, options: { restored?: boolean } = {}): BrowserWindow {
    const context = this.contextFromInput(input, options.restored ?? false);
    const window = createMainWindow(context);
    this.contexts.set(window.id, context);
    this.updateWindowTitle(window, context);
    window.on("focus", () => {
      const next = this.patchContext(window.id, { lastActiveAt: new Date().toISOString() });
      void this.activateWorkspace(next).catch(() => undefined);
    });
    window.on("closed", () => {
      if (!this.quitting) {
        this.contexts.delete(window.id);
        this.persist();
      }
    });
    this.persist();
    return window;
  }

  createInitialWindows(): BrowserWindow {
    const restoreEnabled = this.services.settings.get().restoreWindowsOnLaunch;
    const restoredContexts = restoreEnabled ? this.readPersisted().slice(0, maxRestoredWindows) : [];
    if (restoredContexts.length === 0) return this.createWindow();
    const [firstContext, ...remainingContexts] = restoredContexts;
    const firstWindow = this.createWindow(firstContext, { restored: true });
    if (remainingContexts.length > 0 && process.env.FALLBACK_PERF_SMOKE !== "1") {
      setTimeout(() => {
        if (this.quitting) return;
        for (const context of remainingContexts) this.createWindow(context, { restored: true });
      }, deferredWindowRestoreDelayMs);
    }
    return firstWindow;
  }

  prepareForQuit(): void {
    this.quitting = true;
    this.persist();
  }

  contextForEvent(event: IpcMainInvokeEvent): FallbackWindowContext {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return this.contextFromInput();
    return this.contexts.get(window.id) ?? this.contextFromInput();
  }

  updateContextForEvent(event: IpcMainInvokeEvent, input: FallbackWindowContextInput): FallbackWindowContext {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return this.contextFromInput(input);
    const context = this.patchContext(window.id, sanitizeContextInput(input));
    this.updateWindowTitle(window, context);
    if (window.isFocused()) void this.activateWorkspace(context).catch(() => undefined);
    return context;
  }

  openContext(input: FallbackWindowContextInput): FallbackWindowContext {
    const window = this.createWindow(input);
    void this.activateWorkspace(this.contexts.get(window.id)!).catch(() => undefined);
    window.focus();
    return this.contexts.get(window.id)!;
  }

  listContexts(): FallbackWindowContext[] {
    return [...this.contexts.values()].sort((a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt));
  }

  private patchContext(windowId: number, patch: Partial<FallbackWindowContext>): FallbackWindowContext {
    const current = this.contexts.get(windowId) ?? this.contextFromInput();
    const next = normalizeWindowContext({
      ...current,
      ...patch,
      id: current.id,
      navigationStack: patch.navigationStack ?? current.navigationStack
    });
    this.contexts.set(windowId, next);
    this.persist();
    return next;
  }

  private contextFromInput(input: FallbackWindowContextInput = {}, restored = false): FallbackWindowContext {
    const now = new Date().toISOString();
    return normalizeWindowContext({
      id: `window:${Date.now().toString(36)}:${(this.sequence += 1).toString(36)}`,
      repoId: input.repoId ?? null,
      workspaceId: input.workspaceId ?? null,
      view: validView(input.view) ? input.view : "home",
      selectedEntityId: input.selectedEntityId ?? null,
      navigationStack: input.navigationStack ?? [],
      accountId: input.accountId ?? this.services.database.localCache.accounts.getGitHubAccount()?.id ?? null,
      lastActiveAt: now,
      restored
    });
  }

  private contextsPath(): string {
    return path.join(path.dirname(this.services.settings.configPath()), windowContextsFileName);
  }

  private readPersisted(): FallbackWindowContext[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.contextsPath(), "utf8")) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.map((value) => normalizeWindowContext(value)).filter((context) => context.view !== "Settings");
    } catch {
      return [];
    }
  }

  private persist(): void {
    const contexts = this.listContexts().filter((context) => context.view !== "Settings");
    writeFileIfChanged(this.contextsPath(), `${JSON.stringify(contexts, null, 2)}\n`);
  }

  private updateWindowTitle(window: BrowserWindow, context: FallbackWindowContext): void {
    const repo = context.repoId ? this.services.database.localCache.repos.getRepo(context.repoId) : null;
    const scope = repo ? `${repo.fullName} - ${context.view}` : context.view === "home" ? "Fallback" : `${context.view} - Fallback`;
    window.setTitle(scope);
  }

  private async activateWorkspace(context: FallbackWindowContext): Promise<void> {
    if (!context.repoId || !context.workspaceId) return;
    const active = this.services.database.localCache.repoWorkspaces.activeRepoWorkspace(context.repoId);
    if (active?.id === context.workspaceId) return;
    await this.services.repoWorkspaces.switch(context.repoId, context.workspaceId);
    sendAppEvent("repos", { repoId: context.repoId });
    sendAppEvent("localChanges", { repoId: context.repoId });
  }
}

function writeFileIfChanged(filePath: string, contents: string): void {
  try {
    if (fs.readFileSync(filePath, "utf8") === contents) return;
  } catch {
    // Missing context files are created on the first persist.
  }
  fs.writeFileSync(filePath, contents);
}

function sanitizeContextInput(input: FallbackWindowContextInput): FallbackWindowContextInput {
  return {
    repoId: nullableString(input.repoId),
    workspaceId: nullableString(input.workspaceId),
    view: validView(input.view) ? input.view : undefined,
    selectedEntityId: nullableString(input.selectedEntityId),
    navigationStack: Array.isArray(input.navigationStack)
      ? input.navigationStack.map(normalizeRoute).slice(-maxNavigationStack)
      : undefined,
    accountId: nullableString(input.accountId)
  };
}

function normalizeWindowContext(value: unknown): FallbackWindowContext {
  const record = typeof value === "object" && value !== null ? (value as Partial<FallbackWindowContext>) : {};
  const now = new Date().toISOString();
  return {
    id: typeof record.id === "string" && record.id ? record.id : `window:${Date.now().toString(36)}`,
    repoId: nullableString(record.repoId),
    workspaceId: nullableString(record.workspaceId),
    view: validView(record.view) ? record.view : "home",
    selectedEntityId: nullableString(record.selectedEntityId),
    navigationStack: Array.isArray(record.navigationStack) ? record.navigationStack.map(normalizeRoute).slice(-maxNavigationStack) : [],
    accountId: nullableString(record.accountId),
    lastActiveAt: typeof record.lastActiveAt === "string" ? record.lastActiveAt : now,
    restored: Boolean(record.restored)
  };
}

function normalizeRoute(value: unknown): FallbackWindowRoute {
  const record = typeof value === "object" && value !== null ? (value as Partial<FallbackWindowRoute>) : {};
  return {
    repoId: nullableString(record.repoId),
    workspaceId: nullableString(record.workspaceId),
    view: validView(record.view) ? record.view : "home",
    selectedEntityId: nullableString(record.selectedEntityId),
    label: nullableString(record.label),
    at: typeof record.at === "string" ? record.at : new Date().toISOString()
  };
}

function validView(value: unknown): value is FallbackWindowView {
  return typeof value === "string" && validViews.has(value as FallbackWindowView);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
