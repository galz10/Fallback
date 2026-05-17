import type { RepoSyncContext, RepoSyncMetadata } from "./repo-sync-context.js";
import type { RepoCodeCacheWarmRuntime } from "./repo-sync-stage-runtime.js";

export async function warmRepoCodeCache(
  runtime: RepoCodeCacheWarmRuntime,
  context: RepoSyncContext,
  _metadata: RepoSyncMetadata
): Promise<void> {
  await runtime.warmCodeCaches(context.repoId, context.job.id);
}
