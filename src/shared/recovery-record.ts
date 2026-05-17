import type { OperationRecord } from "./domain/operation.js";

export type OperationRecoveryActionKind =
  | "restore_safety_ref"
  | "inspect_reflog"
  | "apply_result_stash"
  | "copy_recovery_report"
  | "open_diagnostics";

export interface OperationRecoveryAction {
  kind: OperationRecoveryActionKind;
  label: string;
  detail: string;
  command: string | null;
  available: boolean;
  unavailableReason: string | null;
  destructive: boolean;
}

export interface OperationRecoveryState {
  status: "none" | "available" | "assisted" | "stale";
  summary: string;
  actions: OperationRecoveryAction[];
}

export interface RecoveryRecordHintInput {
  headSha: string | null;
  branch: string | null;
  isDirty?: boolean | null;
  fileCount?: number | null;
  stashRefs: string[];
  safetyRef: string | null;
  reflogHint: string | null;
}

export interface RecoverySafetyRefInput {
  operationId?: string;
  operationKind?: string;
}

export function operationRecoveryState(operation: OperationRecord, now = new Date()): OperationRecoveryState {
  const actions: OperationRecoveryAction[] = [];
  const stale = recoveryIsStale(operation, now);
  if (operation.recoveryRef) {
    actions.push({
      kind: "restore_safety_ref",
      label: "Copy safety-ref recovery command",
      detail: "Create a recovery branch at the pre-operation safety ref.",
      command: `git switch -c fallback-recovery-${shortId(operation.id)} ${operation.recoveryRef}`,
      available: !stale,
      unavailableReason: stale ? "Recovery evidence is older than the assisted recovery window." : null,
      destructive: false
    });
  }
  if (operation.resultStashRefs[0]) {
    actions.push({
      kind: "apply_result_stash",
      label: "Copy stash restore command",
      detail: "Apply the stash created by this operation back onto the current worktree.",
      command: `git stash apply ${operation.resultStashRefs[0]}`,
      available: !stale,
      unavailableReason: stale ? "Created stash should be inspected manually before applying." : null,
      destructive: false
    });
  }
  if (operation.recoveryHeadSha || operation.recoveryReflogHint) {
    actions.push({
      kind: "inspect_reflog",
      label: "Copy reflog guidance",
      detail: operation.recoveryReflogHint ?? "Inspect reflog around the pre-operation HEAD.",
      command: operation.recoveryHeadSha
        ? `git reflog --date=iso --all --grep-reflog=${operation.recoveryHeadSha}`
        : "git reflog --date=iso",
      available: true,
      unavailableReason: null,
      destructive: false
    });
  }
  if (operation.status === "failed" || operation.errorCode || operation.recoveryHint) {
    actions.push({
      kind: "open_diagnostics",
      label: "Open diagnostics",
      detail: "Run repo diagnostics before retrying or recovering.",
      command: null,
      available: Boolean(operation.repoId),
      unavailableReason: operation.repoId ? null : "Diagnostics require a repository context.",
      destructive: false
    });
  }
  actions.push({
    kind: "copy_recovery_report",
    label: "Copy recovery report",
    detail: "Copy the redacted operation and recovery summary.",
    command: null,
    available: true,
    unavailableReason: null,
    destructive: false
  });

  if (!operationHasRecoveryEvidence(operation)) {
    return {
      status: "none",
      summary: "No recovery evidence was captured for this operation.",
      actions
    };
  }
  if (stale) {
    return {
      status: "stale",
      summary: "Recovery evidence exists, but current-state validation is required before applying it.",
      actions
    };
  }
  if (actions.some((action) => action.available && action.command)) {
    return {
      status: "available",
      summary: "Assisted recovery commands are available from captured operation metadata.",
      actions
    };
  }
  return {
    status: "assisted",
    summary: "Recovery evidence is available for manual inspection.",
    actions
  };
}

export function recoveryCommandBundle(operation: OperationRecord): string {
  const state = operationRecoveryState(operation);
  const commands = state.actions
    .filter((action) => action.available && action.command)
    .map((action) => `# ${action.label}\n${action.command}`);
  return commands.length > 0 ? commands.join("\n\n") : state.summary;
}

export function operationRecoveryCopy(operation: OperationRecord): string | null {
  if (!operationHasRecoveryEvidence(operation)) return null;
  const state = operationRecoveryState(operation);
  const before = operation.recoveryHeadSha
    ? `Before this operation, HEAD was ${operation.recoveryHeadSha}${operation.recoveryBranch ? ` on ${operation.recoveryBranch}` : ""}.`
    : null;
  const dirty =
    operation.recoveryIsDirty == null
      ? null
      : `The worktree was ${operation.recoveryIsDirty ? "dirty" : "clean"}${
          operation.recoveryFileCount == null ? "" : ` with ${operation.recoveryFileCount} changed files`
        }.`;
  const safety = operation.recoveryRef ? `A safety ref was created at ${operation.recoveryRef}.` : null;
  const stash = operation.recoveryStashRefs[0] ? `Latest pre-operation stash was ${operation.recoveryStashRefs[0]}.` : null;
  const reflog = operation.recoveryReflogHint ? `Recovery hint: ${operation.recoveryReflogHint}` : null;
  return [before, dirty, safety, stash, reflog, state.summary].filter(Boolean).join(" ");
}

export function operationHasRecoveryEvidence(operation: OperationRecord): boolean {
  return Boolean(
    operation.recoveryHeadSha ||
    operation.recoveryRef ||
    operation.recoveryReflogHint ||
    (operation.recoveryStashRefs?.length ?? 0) ||
    (operation.resultStashRefs?.length ?? 0)
  );
}

export function recoveryReflogHint(headSha: string | null): string | null {
  return headSha ? `Inspect git reflog around ${headSha} or run git show ${headSha} to review the pre-operation commit.` : null;
}

export function recoveryRecordHint(input: RecoveryRecordHintInput): string | null {
  if (!input.headSha) return null;
  const before = `Before this operation, HEAD was ${input.headSha}${input.branch ? ` on ${input.branch}` : ""}.`;
  const dirty =
    input.isDirty == null
      ? ""
      : ` The worktree was ${input.isDirty ? "dirty" : "clean"}${input.fileCount == null ? "" : ` with ${input.fileCount} changed files`}.`;
  const safety = input.safetyRef ? ` A safety ref was created at ${input.safetyRef}.` : "";
  const stash = input.stashRefs[0] ? ` Latest pre-operation stash was ${input.stashRefs[0]}.` : "";
  const reflog = input.reflogHint ? ` Recovery hint: ${input.reflogHint}` : "";
  return `${before}${dirty}${safety}${stash}${reflog}`.trim();
}

export function recoverySafetyRef(input: RecoverySafetyRefInput): string | null {
  if (!input.operationId) return null;
  return `refs/fallback/operations/${safeRefComponent(input.operationKind ?? "operation")}/${safeRefComponent(input.operationId)}`;
}

export function safeRefComponent(value: string): string {
  return value
    .replaceAll(/[^A-Za-z0-9._-]/g, "-")
    .replaceAll(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
}

function recoveryIsStale(operation: OperationRecord, now: Date): boolean {
  const reference = operation.completedAt ?? operation.startedAt ?? operation.createdAt;
  const timestamp = Date.parse(reference);
  if (!Number.isFinite(timestamp)) return false;
  return now.getTime() - timestamp > 7 * 24 * 60 * 60 * 1000;
}

function shortId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "operation";
}
