import type { OperationRiskLevel } from "../../../../src/shared/domain/operation.js";
import type { AppServices } from "../../app-services.js";
import type { OperationExecutionContext, OperationResultPatch } from "../../operation-service.js";
import { localGitOperationPolicy } from "./local-git-operation-catalog.js";

interface RepoOperationScope {
  workspaceId?: string | null;
  workspacePath?: string | null;
  workspaceBranch?: string | null;
}

export class RepoOperationRunner {
  constructor(private readonly services: AppServices) {}

  run<T>(
    repoId: string,
    kind: string,
    riskLevel: OperationRiskLevel,
    commandSummary: string,
    redactedCommand: string,
    execute: (context: OperationExecutionContext) => Promise<T>,
    includeLocalRecovery = true,
    recoverySafetyTargetRef?: string | null,
    postflight?: ((result: T, context: OperationExecutionContext) => OperationResultPatch | null) | null,
    scope: RepoOperationScope = {}
  ): Promise<T> {
    const policy = localGitOperationPolicy(kind, riskLevel);
    return this.services.operations.run({
      repoId,
      ...scope,
      kind,
      riskLevel,
      commandSummary,
      redactedCommand,
      preflight:
        includeLocalRecovery && policy.capturesRecovery
          ? (context) =>
              this.services.localGit.recoverySnapshot(repoId, {
                operationId: context.operationId,
                operationKind: kind,
                createSafetyRef: policy.createsSafetyRef,
                safetyTargetRef: recoverySafetyTargetRef
              })
          : undefined,
      execute,
      postflight: postflight ?? undefined
    });
  }

  stashOperationResult(result: { createdStashRef?: string | null }): OperationResultPatch | null {
    return result.createdStashRef
      ? {
          resultSummary: `Created stash ${result.createdStashRef}.`,
          resultStashRefs: [result.createdStashRef]
        }
      : null;
  }
}
