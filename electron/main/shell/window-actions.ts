import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { FallbackWindowContextInput } from "../../../src/shared/domain/window-context.js";

export type CreateWindow = (input?: FallbackWindowContextInput) => BrowserWindow;

export function focusMainWindow(createWindow: CreateWindow): void {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) {
    createWindow();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.focus();
}

export function closeSenderWindow(event: IpcMainInvokeEvent): void {
  BrowserWindow.fromWebContents(event.sender)?.close();
}

export function minimizeSenderWindow(event: IpcMainInvokeEvent): void {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
}

export function toggleSenderWindowMaximized(event: IpcMainInvokeEvent): void {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
}
