import { app, BrowserWindow } from "electron";
import path from "node:path";
import type { AppServices } from "../app-services.js";
import { errorMessage } from "../error-classification.js";
import { ipcChannels } from "../../../src/shared/ipc.js";
import type { GitHubBrowserOAuthResult } from "../../../src/shared/domain/auth.js";
import { sendAppEvent } from "../ipc/app-events.js";

export class ProtocolClient {
  private registered = false;

  constructor(private readonly services: AppServices) {}

  get isRegistered(): boolean {
    return this.registered;
  }

  register(): void {
    const protocol = "fallback";
    if ((process as NodeJS.Process & { defaultApp?: boolean }).defaultApp) {
      const appPath = process.argv[1];
      this.registered = appPath ? app.setAsDefaultProtocolClient(protocol, process.execPath, [path.resolve(appPath)]) : false;
      return;
    }
    this.registered = app.setAsDefaultProtocolClient(protocol);
  }

  handleUrlFromArgv(argv: string[]): void {
    const callbackUrl = argv.find((arg) => arg.startsWith("fallback://"));
    if (callbackUrl) void this.handleOAuthCallbackUrl(callbackUrl);
  }

  async handleOAuthCallbackUrl(callbackUrl: string): Promise<void> {
    if (!callbackUrl.startsWith("fallback://oauth")) return;
    try {
      await this.services.auth.completeGitHubBrowserOAuth(callbackUrl);
      sendAppEvent("profile", {});
      sendAppEvent("repos", {});
      sendAppEvent("notifications", {});
      this.broadcastBrowserOAuthResult({ status: "success", message: "GitHub connected." });
    } catch (error) {
      this.broadcastBrowserOAuthResult({ status: "error", message: errorMessage(error) });
    }
  }

  private broadcastBrowserOAuthResult(result: GitHubBrowserOAuthResult): void {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(ipcChannels.authBrowserOAuthResult, result);
    }
  }
}
