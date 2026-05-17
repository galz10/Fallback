import { recoveryRecordHint, recoveryReflogHint, recoverySafetyRef } from "../../../src/shared/recovery-record.js";
import { gitRaw, gitText } from "../git-command.js";
import { LocalGitWorkflowBase, type LocalGitWorkflowDependencies } from "./workflow-base.js";
import { gitStashes, gitStatus } from "./git-workflow-helpers.js";
import type { LocalGitRecoverySnapshotOptions } from "./git-workflow-helpers.js";

export class GitRecoverySnapshot extends LocalGitWorkflowBase {
  constructor(deps: LocalGitWorkflowDependencies) {
    super(deps);
  }

  async recoverySnapshot(
    repoId: string,
    options: LocalGitRecoverySnapshotOptions = {}
  ): Promise<{
    headSha: string | null;
    branch: string | null;
    isDirty: boolean | null;
    fileCount: number | null;
    stashRefs: string[];
    hint: string | null;
    reflogHint: string | null;
    ref: string | null;
  }> {
    const repo = this.requireLocalRepo(repoId);
    const [headSha, branch, stashes, statusEntries] = await Promise.all([
      gitText(repo.localPath, ["rev-parse", "--short", "HEAD"]).catch(() => null),
      gitText(repo.localPath, ["branch", "--show-current"]).catch(() => repo.defaultBranch),
      gitStashes(repo.localPath).catch(() => []),
      gitStatus(repo.localPath).catch(() => null)
    ]);
    const safetyRef = await this.createRecoverySafetyRef(repo.localPath, headSha, options);
    const stashRefs = stashes.map((stash) => stash.ref);
    const reflogHint = recoveryReflogHint(headSha);
    return {
      headSha,
      branch,
      isDirty: statusEntries ? statusEntries.length > 0 : null,
      fileCount: statusEntries?.length ?? null,
      stashRefs,
      hint: recoveryRecordHint({
        headSha,
        branch,
        isDirty: statusEntries ? statusEntries.length > 0 : null,
        fileCount: statusEntries?.length ?? null,
        stashRefs,
        safetyRef,
        reflogHint
      }),
      reflogHint,
      ref: safetyRef
    };
  }

  private async createRecoverySafetyRef(
    localPath: string,
    headSha: string | null,
    options: LocalGitRecoverySnapshotOptions
  ): Promise<string | null> {
    if (!options.createSafetyRef || !options.operationId) return null;
    const target = options.safetyTargetRef ? await gitText(localPath, ["rev-parse", options.safetyTargetRef]).catch(() => null) : headSha;
    if (!target) return null;
    const ref = recoverySafetyRef({ operationId: options.operationId, operationKind: options.operationKind });
    if (!ref) return null;
    await gitRaw(localPath, ["update-ref", ref, target], 30_000).catch(() => "");
    const exists = await gitText(localPath, ["show-ref", "--hash", ref]).catch(() => null);
    return exists ? ref : null;
  }
}
