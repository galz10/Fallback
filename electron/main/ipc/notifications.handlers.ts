import { syncPriority } from "../../../src/shared/sync-policy.js";
import type { AttentionListInput } from "../../../src/shared/attention.js";
import type { AppServices } from "../app-services.js";
import { onAppEvent, sendAppEvent } from "./app-events.js";
import { assertString } from "./validation.js";
import { createIpcHandlerRegistrar } from "./ipc-handler-registry.js";

const notificationCacheTtlMs = 60_000;

export function registerNotificationsHandlers(services: AppServices): void {
  const ipc = createIpcHandlerRegistrar(services);
  const cache = new Map<string, { expiresAt: number; value: unknown }>();
  const cached = <T>(key: string, load: () => T): T => {
    const scopedKey = accountScopedCacheKey(services, key);
    const current = cache.get(scopedKey) as { expiresAt: number; value: T } | undefined;
    if (current && current.expiresAt > Date.now()) return current.value;
    const value = load();
    cache.set(scopedKey, { expiresAt: Date.now() + notificationCacheTtlMs, value });
    return value;
  };
  onAppEvent((name) => {
    if (name === "notifications" || name === "sync" || name === "repos" || name === "profile") cache.clear();
  });

  ipc.handle("notificationsSummary", async () => cached("summary", () => services.attention.summary()));
  ipc.handle("notificationsList", async (_event, input?: AttentionListInput) => {
    const normalized = normalizeListInput(input);
    return cached(`list:${stableInputKey(normalized)}`, () => services.attention.list(normalized));
  });
  ipc.handle("notificationsMarkRead", async (_event, ids: string[]) =>
    notifyAfter(services.attention.markRead(assertStringArray(ids, "IDs")))
  );
  ipc.handle("notificationsMarkAllRead", async (_event, input?: AttentionListInput) =>
    notifyAfter(services.attention.markAllRead(normalizeListInput(input)))
  );
  ipc.handle("notificationsMarkDone", async (_event, id: string) =>
    notifyAfter(services.attention.markDone(assertString(id, "Attention ID")))
  );
  ipc.handle("notificationsUndoDone", async (_event, id: string) =>
    notifyAfter(services.attention.undoDone(assertString(id, "Attention ID")))
  );
  ipc.handle("notificationsSnooze", async (_event, id: string, until: string) =>
    notifyAfter(services.attention.snooze(assertString(id, "Attention ID"), assertString(until, "Snooze time")))
  );
  ipc.handle("notificationsUnsnooze", async (_event, id: string) =>
    notifyAfter(services.attention.unsnooze(assertString(id, "Attention ID")))
  );
  ipc.handle("notificationsMute", async (_event, id: string, until?: string | null) =>
    notifyAfter(services.attention.mute(assertString(id, "Attention ID"), until == null ? null : assertString(until, "Mute time")))
  );
  ipc.handle("notificationsUnmute", async (_event, id: string) => notifyAfter(services.attention.unmute(assertString(id, "Attention ID"))));
  ipc.handle("notificationsRefresh", async () => {
    const result = await services.sync.syncUserPullRequests({
      priority: syncPriority.manual,
      reason: "notifications_refresh",
      bypassCooldown: true
    });
    sendAppEvent("notifications", {});
    sendAppEvent("sync", {});
    return result;
  });
}

function stableInputKey(input: AttentionListInput): string {
  return JSON.stringify({
    surface: input.surface ?? null,
    lane: input.lane ?? null,
    filter: input.filter ?? null,
    repoId: input.repoId ?? null,
    limit: input.limit ?? null
  });
}

function accountScopedCacheKey(services: AppServices, key: string): string {
  const account = services.database.localCache.accounts.getGitHubAccount();
  return `${account?.id ?? "anonymous"}:${key}`;
}

async function notifyAfter<T>(value: T | Promise<T>): Promise<T> {
  const result = await Promise.resolve(value);
  sendAppEvent("notifications", {});
  return result;
}

function normalizeListInput(input: AttentionListInput | undefined): AttentionListInput {
  return {
    surface: input?.surface,
    lane: input?.lane,
    filter: input?.filter,
    repoId: input?.repoId,
    limit: input?.limit
  };
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((item) => assertString(item, label));
}
