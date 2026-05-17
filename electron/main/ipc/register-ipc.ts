import type { AppServices } from "../app-services.js";
import type { ProtocolClient } from "../shell/protocol-client.js";
import type { WindowManager } from "../window-manager.js";
import { registerAppUpdateHandlers } from "./app-update.handlers.js";
import { registerAuthHandlers } from "./auth.handlers.js";
import { registerBranchIntegrityHandlers } from "./branch-integrity.handlers.js";
import { registerCacheHandlers } from "./cache.handlers.js";
import { registerDiagnosticsHandlers } from "./diagnostics.handlers.js";
import { registerGitHubWorkHandlers } from "./github-work.handlers.js";
import { registerLocalGitHandlers } from "./local-git.handlers.js";
import { registerNotificationsHandlers } from "./notifications.handlers.js";
import { registerOfflineActionsHandlers } from "./offline-actions.handlers.js";
import { registerRepoGroupsHandlers } from "./repo-groups.handlers.js";
import { registerSettingsHandlers } from "./settings.handlers.js";
import { registerShellHandlers } from "./shell.handlers.js";
import { registerStartupHandlers } from "./startup.handlers.js";
import { registerWatchedReposHandlers } from "./watched-repos.handlers.js";
import { registerWindowHandlers } from "./window.handlers.js";
import { installIpcPerformanceLogging } from "./performance.js";

export interface RegisterIpcAdapters {
  protocolClient: ProtocolClient;
  windowManager: WindowManager;
}

export function registerIpcHandlers(services: AppServices, adapters: RegisterIpcAdapters): void {
  installIpcPerformanceLogging();
  registerWindowHandlers(adapters.windowManager);
  registerStartupHandlers(services, adapters.windowManager);
  registerAuthHandlers(services, adapters.protocolClient);
  registerWatchedReposHandlers(services);
  registerLocalGitHandlers(services);
  registerRepoGroupsHandlers(services);
  registerGitHubWorkHandlers(services);
  registerNotificationsHandlers(services);
  registerOfflineActionsHandlers(services);
  registerBranchIntegrityHandlers(services);
  registerDiagnosticsHandlers(services);
  registerSettingsHandlers(services);
  registerCacheHandlers(services);
  registerAppUpdateHandlers(services);
  registerShellHandlers(services);
}
