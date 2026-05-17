import { ipcMain } from "electron";
import { isFirstUsableMarked } from "../performance.js";

let installed = false;

export function installIpcPerformanceLogging(thresholdMs = 50): void {
  if (installed) return;
  installed = true;

  const originalHandle: typeof ipcMain.handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = ((channel, listener) =>
    originalHandle(channel, async (event, ...args) => {
      const startedAt = performance.now();
      let handlerEndedAt: number | null = null;
      let result: unknown;
      try {
        result = await listener(event, ...args);
        handlerEndedAt = performance.now();
        return result;
      } finally {
        const durationMs = performance.now() - startedAt;
        const handlerMs = (handlerEndedAt ?? performance.now()) - startedAt;
        const channelThresholdMs = thresholdForChannel(String(channel), thresholdMs);
        if (durationMs >= channelThresholdMs) {
          const phase = isFirstUsableMarked() ? "post-usable slow IPC" : "startup IPC budget miss";
          const payloadCopy = handlerEndedAt == null ? "" : ` resultBytes=${resultPayloadBytes(result) ?? "unknown"}`;
          console.warn(
            `[perf] ${phase} ${String(channel)}: ${Math.round(durationMs)}ms handler=${Math.round(handlerMs)}ms threshold=${channelThresholdMs}ms${payloadCopy}`
          );
        }
      }
    })) as typeof ipcMain.handle;
}

function thresholdForChannel(channel: string, fallback: number): number {
  if (/:(list|get|summary|matrix|history|offline-status|code-summary|local-changes-overview|local-changes-summary)$/.test(channel)) {
    return 50;
  }
  if (channel === "cache:summary-detailed") return 1000;
  if (/(local-change-patch|local-changes|search-commits|list-files|read-file)$/.test(channel)) return 250;
  if (/(refresh|sync|probe|audit|inspect-diff|recovery|fetch-safety|connect|oauth)/.test(channel)) return 1000;
  return fallback;
}

function resultPayloadBytes(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return null;
  }
}
