import type { UpdateRepoGroupsInput } from "../../../src/shared/domain/repo-group.js";
import type { AppServices } from "../app-services.js";
import { assertString, assertStringArray } from "./validation.js";
import { createIpcHandlerRegistrar } from "./ipc-handler-registry.js";

export function registerRepoGroupsHandlers(services: AppServices): void {
  const ipc = createIpcHandlerRegistrar(services);
  ipc.handle("repoGroupsList", async () => services.database.localCache.repoGroups.listRepoGroupsForActiveAccount());
  ipc.handle("repoGroupsCreate", async (_event, input: UpdateRepoGroupsInput) =>
    services.database.localCache.repoGroups.createRepoGroup(input)
  );
  ipc.handle("repoGroupsUpdate", async (_event, groupId: string, input: UpdateRepoGroupsInput) =>
    services.database.localCache.repoGroups.updateRepoGroup(assertString(groupId, "Group ID"), input)
  );
  ipc.handle("repoGroupsDelete", async (_event, groupId: string) =>
    services.database.localCache.repoGroups.deleteRepoGroup(assertString(groupId, "Group ID"))
  );
  ipc.handle("repoGroupsSetMemberships", async (_event, groupId: string, repoIds: string[]) =>
    services.database.localCache.repoGroups.setRepoGroupMemberships(
      assertString(groupId, "Group ID"),
      assertStringArray(repoIds, "Repo IDs")
    )
  );
}
