import { shell } from "electron";
import type { AppServices } from "../app-services.js";
import type { ProtocolClient } from "../shell/protocol-client.js";
import { sendAppEvent } from "./app-events.js";
import { assertHttpsUrl, assertString } from "./validation.js";
import { createIpcHandlerRegistrar } from "./ipc-handler-registry.js";

export function registerAuthHandlers(services: AppServices, protocolClient: ProtocolClient): void {
  const ipc = createIpcHandlerRegistrar(services);
  ipc.handle("authConnectGitHub", async (_event, token?: string) => {
    await services.auth.connectGitHub(token);
  });

  ipc.handle("authStartGitHubBrowserOAuth", async () => {
    if (!protocolClient.isRegistered) {
      throw new Error("Browser sign-in callback is unavailable. Use device code instead.");
    }
    const flow = await services.auth.startGitHubBrowserOAuth();
    await shell.openExternal(assertHttpsUrl(flow.authorizationUrl));
    return flow;
  });

  ipc.handle("authStartAddGitHubProfileOAuth", async () => {
    if (!protocolClient.isRegistered) {
      throw new Error("Browser sign-in callback is unavailable. Use device code instead.");
    }
    const flow = await services.auth.startAddGitHubProfileOAuth();
    await shell.openExternal(assertHttpsUrl(flow.authorizationUrl));
    return flow;
  });

  ipc.handle("authCancelGitHubBrowserOAuth", async () => {
    await services.auth.cancelGitHubBrowserOAuth();
  });

  ipc.handle("authStartGitHubOAuth", async () => {
    const flow = await services.auth.startGitHubOAuth();
    await shell.openExternal(assertHttpsUrl(flow.verificationUriComplete ?? flow.verificationUri));
    return flow;
  });

  ipc.handle("authCompleteGitHubOAuth", async (_event, deviceCode: string) =>
    services.auth.completeGitHubOAuth(assertString(deviceCode, "Device code"))
  );
  ipc.handle("authGetState", async () => services.auth.getAuthState());
  ipc.handle("authListAccounts", async () => services.auth.listAccounts());
  ipc.handle("authListProfiles", async () => services.auth.listProfiles());
  ipc.handle("authSelectAccount", async (_event, accountId: string) => {
    await services.auth.selectAccount(assertString(accountId, "Account ID"));
    sendProfileChanged();
  });
  ipc.handle("authSelectProfile", async (_event, profileId: string) => {
    await services.auth.selectProfile(assertString(profileId, "Profile ID"));
    sendProfileChanged();
  });
  ipc.handle("authUpdateProfile", async (_event, profileId: string, input) => {
    const result = services.auth.updateProfile(assertString(profileId, "Profile ID"), input ?? {});
    sendProfileChanged();
    return result;
  });
  ipc.handle("authRenameProfile", async (_event, profileId: string, name: string) => {
    const result = services.auth.renameProfile(assertString(profileId, "Profile ID"), assertString(name, "Profile name"));
    sendProfileChanged();
    return result;
  });
  ipc.handle("authUpdateProfileColor", async (_event, profileId: string, color: string | null) => {
    const result = services.auth.updateProfileColor(
      assertString(profileId, "Profile ID"),
      color == null ? null : assertString(color, "Profile color")
    );
    sendProfileChanged();
    return result;
  });
  ipc.handle("authReconnectProfile", async (_event, profileId: string) => {
    if (!protocolClient.isRegistered) {
      throw new Error("Browser sign-in callback is unavailable. Use device code instead.");
    }
    const flow = await services.auth.reconnectProfile(assertString(profileId, "Profile ID"));
    await shell.openExternal(assertHttpsUrl(flow.authorizationUrl));
    return flow;
  });
  ipc.handle("authDeleteAccount", async (_event, accountId: string) => {
    await services.auth.deleteAccount(assertString(accountId, "Account ID"));
    sendProfileChanged();
  });
  ipc.handle("authRemoveProfile", async (_event, profileId: string) => {
    await services.auth.removeProfile(assertString(profileId, "Profile ID"));
    sendProfileChanged();
  });
  ipc.handle("authDeleteAllAccounts", async () => {
    await services.auth.deleteAllAccounts();
    sendProfileChanged();
  });
  ipc.handle("authDisconnectGitHub", async () => {
    await services.auth.disconnectGitHub();
    sendProfileChanged();
  });
}

function sendProfileChanged(): void {
  sendAppEvent("profile", {});
  sendAppEvent("repos", {});
  sendAppEvent("notifications", {});
  sendAppEvent("sync", {});
}
