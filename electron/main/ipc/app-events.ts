import { BrowserWindow } from "electron";
import { ipcChannels } from "../../../src/shared/ipc.js";
import type { AppEventPayload } from "../../../src/shared/contracts/fallback-api.js";

type AppEventName =
  | "repos"
  | "profile"
  | "localChanges"
  | "operations"
  | "sync"
  | "notifications"
  | "offlineActions"
  | "branchIntegrity"
  | "health"
  | "appUpdate";

const eventChannels: Record<AppEventName, string> = {
  repos: ipcChannels.eventsReposChanged,
  profile: ipcChannels.eventsProfileChanged,
  localChanges: ipcChannels.eventsLocalChangesChanged,
  operations: ipcChannels.eventsOperationsChanged,
  sync: ipcChannels.eventsSyncChanged,
  notifications: ipcChannels.eventsNotificationsChanged,
  offlineActions: ipcChannels.eventsOfflineActionsChanged,
  branchIntegrity: ipcChannels.eventsBranchIntegrityChanged,
  health: ipcChannels.eventsHealthChanged,
  appUpdate: ipcChannels.eventsAppUpdateChanged
};

export function sendAppEvent(name: AppEventName, payload: AppEventPayload = {}): void {
  for (const listener of appEventListeners) listener(name, payload);
  const channel = eventChannels[name];
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

type AppEventListener = (name: AppEventName, payload: AppEventPayload) => void;

const appEventListeners = new Set<AppEventListener>();

export function onAppEvent(listener: AppEventListener): () => void {
  appEventListeners.add(listener);
  return () => appEventListeners.delete(listener);
}
