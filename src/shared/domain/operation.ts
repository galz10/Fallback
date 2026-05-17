export type OperationStatus = "queued" | "preflight" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";

export type OperationRiskLevel = "low" | "normal" | "destructive";

export interface OperationRecord {
  id: string;
  repoId: string | null;
  repoFullName: string | null;
  workspaceId: string | null;
  workspacePath: string | null;
  workspaceBranch: string | null;
  kind: string;
  status: OperationStatus;
  riskLevel: OperationRiskLevel;
  commandSummary: string | null;
  redactedCommand: string | null;
  recoveryHeadSha: string | null;
  recoveryBranch: string | null;
  recoveryIsDirty: boolean | null;
  recoveryFileCount: number | null;
  recoveryStashRefs: string[];
  recoveryHint: string | null;
  recoveryReflogHint: string | null;
  recoveryRef: string | null;
  resultSummary: string | null;
  resultStashRefs: string[];
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
