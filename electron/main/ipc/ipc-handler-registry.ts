import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { ipcChannelMetadata, type IpcInvokeChannelKey } from "../../../src/shared/ipc.js";
import type { AppServices } from "../app-services.js";

// IPC handlers are registered with domain-specific argument lists; the registrar preserves those runtime arguments.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IpcInvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;

export interface IpcHandleOptions {
  readonly repoIdArgument?: number | false;
}

export function handleIpc<Key extends IpcInvokeChannelKey>(key: Key, handler: IpcInvokeHandler): void {
  const metadata = ipcChannelMetadata[key];
  if (metadata.kind !== "invoke" || metadata.handlerCoverage !== "main") {
    throw new Error(`${metadata.channel} is not a main-process invoke channel.`);
  }
  ipcMain.handle(metadata.channel, handler);
}

export function createIpcHandlerRegistrar(services: AppServices): {
  handle<Key extends IpcInvokeChannelKey>(key: Key, handler: IpcInvokeHandler, options?: IpcHandleOptions): void;
} {
  return {
    handle(key, handler, options = {}) {
      const metadata = ipcChannelMetadata[key];
      handleIpc(key, async (event, ...args) => {
        const repoIdArgument = options.repoIdArgument ?? metadata.repoIdArgument;
        if (metadata.repoVisibility === "required" && repoIdArgument !== false) {
          const repoId = args[repoIdArgument ?? 0];
          if (typeof repoId !== "string" || repoId.length === 0) throw new Error("Repo ID must be a non-empty string.");
          services.database.localCache.repos.requireRepoVisibleToActiveAccount(repoId);
        }
        return handler(event, ...args);
      });
    }
  };
}
