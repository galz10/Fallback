import type { RepoSyncContext } from "./repo-sync-context.js";
import type { WorkflowRunHydrationRuntime } from "./repo-sync-stage-runtime.js";

export async function hydrateWorkflowRuns(runtime: WorkflowRunHydrationRuntime, context: RepoSyncContext): Promise<void> {
  runtime.progress(context, "Caching workflow runs");
  await runtime.syncWorkflowRuns(context.repoId, context.apiPath);
}
