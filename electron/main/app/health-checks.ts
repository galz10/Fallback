import type { AppServices } from "../app-services.js";
import { sendAppEvent } from "../ipc/app-events.js";

export interface HealthChecks {
  start(): void;
  stop(): void;
}

export function createHealthChecks(services: AppServices): HealthChecks {
  let globalHealthTimer: NodeJS.Timeout | null = null;
  let repoHealthTimer: NodeJS.Timeout | null = null;
  const startupTimers = new Set<NodeJS.Timeout>();

  const scheduleStartup = (callback: () => void, delayMs: number): void => {
    const timer = setTimeout(() => {
      startupTimers.delete(timer);
      callback();
    }, delayMs);
    startupTimers.add(timer);
  };

  const runHealthProbe = (repoId?: string): void => {
    void services.health
      .runProbe(repoId)
      .then(() => sendAppEvent("health", { repoId }))
      .catch((error: unknown) => {
        console.warn("Health probe failed", error);
      });
  };

  const runRepoHealthProbes = (): void => {
    services.database.localCache.repos.listWatchedReposForActiveAccount().forEach((repo, index) => {
      scheduleStartup(() => runHealthProbe(repo.id), index * 2_500);
    });
  };

  return {
    start() {
      scheduleStartup(() => runHealthProbe(), 5_000);
      scheduleStartup(runRepoHealthProbes, 10_000);
      globalHealthTimer = setInterval(() => runHealthProbe(), 5 * 60 * 1000);
      repoHealthTimer = setInterval(runRepoHealthProbes, 15 * 60 * 1000);
    },
    stop() {
      for (const timer of startupTimers) clearTimeout(timer);
      startupTimers.clear();
      if (globalHealthTimer) clearInterval(globalHealthTimer);
      if (repoHealthTimer) clearInterval(repoHealthTimer);
      globalHealthTimer = null;
      repoHealthTimer = null;
    }
  };
}
