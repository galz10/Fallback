import { ipcChannelMetadata } from "../../src/shared/contracts/ipc-channels.js";

export function ipcContractFixture(): typeof ipcChannelMetadata {
  return ipcChannelMetadata;
}
