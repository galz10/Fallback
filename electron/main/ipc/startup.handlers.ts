import type { StartupSnapshot } from "../../../src/shared/contracts/fallback-api.js";
import type { AuthState, GitHubAccountSession } from "../../../src/shared/domain/auth.js";
import type { AppServices } from "../app-services.js";
import type { WindowManager } from "../window-manager.js";
import { createIpcHandlerRegistrar } from "./ipc-handler-registry.js";

export function registerStartupHandlers(services: AppServices, windowManager: WindowManager): void {
  const ipc = createIpcHandlerRegistrar(services);
  ipc.handle("startupSnapshot", async (event): Promise<StartupSnapshot> => {
    const timings: Array<[string, number]> = [];
    const account = timeStartupPart(timings, "account", () => services.database.localCache.accounts.getGitHubAccount());
    const profiles = timeStartupPart(timings, "profiles", () =>
      services.database.localCache.accounts.listGitHubAccounts().map(startupProfile)
    );
    const repos = timeStartupPart(timings, "repo-shells", () => services.database.localCache.repos.listStartupRepoShellsForActiveAccount());
    const cacheSummary = timeStartupPart(timings, "cache-snapshot", () => services.cache.summarySnapshot());
    const windowContext = timeStartupPart(timings, "window-context", () => windowManager.contextForEvent(event));
    const snapshot = {
      auth: cachedAuthState(account),
      profiles,
      activeProfileId: account?.id ?? null,
      repos,
      cacheSummary,
      selectedRepoId: null,
      windowContext,
      cachedAt: new Date().toISOString()
    };
    logStartupSnapshotTiming(snapshot, timings);
    return snapshot;
  });
}

function cachedAuthState(account: GitHubAccountSession | null): AuthState {
  if (!account || !account.tokenSource || account.authStatus === "disconnected") return { status: "disconnected" };
  const details = {
    accountId: account.id,
    endpoint: account.endpoint,
    htmlUrl: account.htmlUrl,
    login: account.login ?? undefined,
    avatarUrl: account.avatarUrl,
    name: account.name,
    profileName: account.profileName,
    profileColor: account.profileColor,
    accountType: account.accountType,
    tokenScopes: account.tokenScopes,
    lastValidatedAt: account.lastValidatedAt
  };

  if (account.authStatus === "connected") {
    return { status: "connected", source: account.tokenSource, ...details };
  }

  return {
    status: account.authStatus,
    message: "Using cached GitHub authentication state while Fallback validates in the background.",
    ...details
  };
}

function startupProfile(account: GitHubAccountSession): GitHubAccountSession {
  return {
    ...account,
    avatarCachedUrl: null
  };
}

function timeStartupPart<T>(timings: Array<[string, number]>, name: string, load: () => T): T {
  const startedAt = performance.now();
  try {
    return load();
  } finally {
    timings.push([name, performance.now() - startedAt]);
  }
}

function logStartupSnapshotTiming(snapshot: StartupSnapshot, timings: Array<[string, number]>): void {
  const totalMs = timings.reduce((sum, [, ms]) => sum + ms, 0);
  if (totalMs < 25 && process.env.FALLBACK_PERF_SMOKE !== "1") return;
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  console.info(
    `[perf] startup snapshot phases ${timings
      .map(([name, ms]) => `${name}=${Math.round(ms)}ms`)
      .join(" ")} total=${Math.round(totalMs)}ms bytes=${bytes}`
  );
}
