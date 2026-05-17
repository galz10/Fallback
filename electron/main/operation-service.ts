import { errorCode, errorMessage } from "./error-classification.js";
import type { OperationRecord, OperationRiskLevel } from "../../src/shared/domain/operation.js";
import type { OperationRecordInput } from "./local-cache/operation-record-store.js";

export interface RecoverySnapshot {
  headSha: string | null;
  branch: string | null;
  isDirty: boolean | null;
  fileCount: number | null;
  stashRefs: string[];
  hint: string | null;
  reflogHint: string | null;
  ref: string | null;
}

export interface OperationRunInput<T> {
  repoId?: string | null;
  workspaceId?: string | null;
  workspacePath?: string | null;
  workspaceBranch?: string | null;
  kind: string;
  riskLevel?: OperationRiskLevel;
  commandSummary?: string | null;
  redactedCommand?: string | null;
  timeoutMs?: number;
  preflight?: (context: OperationExecutionContext) => Promise<RecoverySnapshot>;
  postflight?: (result: T, context: OperationExecutionContext) => Promise<OperationResultPatch | null> | OperationResultPatch | null;
  execute: (context: OperationExecutionContext) => Promise<T>;
}

export interface OperationExecutionContext {
  operationId: string;
  signal: AbortSignal;
}

export interface OperationResultPatch {
  resultSummary?: string | null;
  resultStashRefs?: string[];
}

export interface OperationRecordStorePort {
  create(input: OperationRecordInput): OperationRecord;
  update(id: string, patch: Partial<OperationRecord>): OperationRecord | null;
  get(id: string): OperationRecord | null;
  listRecent(repoId?: string): OperationRecord[];
  active(repoId: string): OperationRecord | null;
}

export interface OperationRepoContextPort {
  activeRepoWorkspace(repoId: string): { id: string; localPath: string | null; branch: string | null } | null;
  requireRepoVisibleToActiveAccount(repoId: string): void;
  listWatchedReposForActiveAccount(): Array<{ id: string }>;
}

export interface OperationDiagnosticPort {
  recordDiagnosticEvent(input: { source: string; level: "info" | "warn" | "error"; code: string; message?: string | null }): void;
}

export interface OperationServiceDependencies {
  records: OperationRecordStorePort;
  repoContext: OperationRepoContextPort;
  diagnostics: OperationDiagnosticPort;
}

export class OperationService {
  private readonly controllers = new Map<string, AbortController>();
  private readonly activeScopes = new Map<string, string>();

  constructor(private readonly dependencies: OperationServiceDependencies) {}

  listRecent(repoId?: string): OperationRecord[] {
    if (repoId) this.dependencies.repoContext.requireRepoVisibleToActiveAccount(repoId);
    if (!repoId) {
      const visible = new Set(this.dependencies.repoContext.listWatchedReposForActiveAccount().map((repo) => repo.id));
      return this.dependencies.records.listRecent().filter((operation) => !operation.repoId || visible.has(operation.repoId));
    }
    return this.dependencies.records.listRecent(repoId);
  }

  cancel(operationId: string): OperationRecord | null {
    const operation = this.dependencies.records.get(operationId);
    if (!operation) return null;
    if (!isActiveOperationStatus(operation.status)) return operation;
    this.controllers.get(operationId)?.abort();
    return this.dependencies.records.update(operationId, {
      errorCode: "operation_cancelled",
      errorMessage: "Operation cancellation was requested; waiting for the underlying command to stop."
    });
  }

  async run<T>(input: OperationRunInput<T>): Promise<T> {
    const activeWorkspace = input.repoId ? this.dependencies.repoContext.activeRepoWorkspace(input.repoId) : null;
    const scopeKey = operationScopeKey(input, activeWorkspace);
    if (scopeKey) {
      const activeOperationId = this.activeScopes.get(scopeKey);
      if (activeOperationId) {
        const activeOperation = this.dependencies.records.get(activeOperationId);
        if (activeOperation && isActiveOperationStatus(activeOperation.status)) {
          throw new Error(
            `Another operation is already running for this ${input.workspaceId || input.workspacePath || activeWorkspace ? "workspace" : "repo"}. Wait for it to finish before starting ${input.kind}.`
          );
        }
        this.activeScopes.delete(scopeKey);
      }
    }
    const operation = this.dependencies.records.create({
      repoId: input.repoId ?? null,
      workspaceId: input.workspaceId ?? activeWorkspace?.id ?? null,
      workspacePath: input.workspacePath ?? activeWorkspace?.localPath ?? null,
      workspaceBranch: input.workspaceBranch ?? activeWorkspace?.branch ?? null,
      kind: input.kind,
      status: "queued",
      riskLevel: input.riskLevel ?? "normal",
      commandSummary: input.commandSummary ?? null,
      redactedCommand: input.redactedCommand ?? null
    });
    const started = Date.now();
    const controller = new AbortController();
    const context = { operationId: operation.id, signal: controller.signal };
    this.controllers.set(operation.id, controller);
    if (scopeKey) this.activeScopes.set(scopeKey, operation.id);
    try {
      this.dependencies.records.update(operation.id, { status: "preflight", startedAt: new Date(started).toISOString() });
      const result = await withOperationDeadline(
        async () => {
          const recovery = input.preflight ? await input.preflight(context) : null;
          if (recovery) {
            this.dependencies.records.update(operation.id, {
              recoveryHeadSha: recovery.headSha,
              recoveryBranch: recovery.branch,
              recoveryIsDirty: recovery.isDirty,
              recoveryFileCount: recovery.fileCount,
              recoveryStashRefs: recovery.stashRefs,
              recoveryHint: recovery.hint,
              recoveryReflogHint: recovery.reflogHint,
              recoveryRef: recovery.ref
            });
          }
          throwIfAborted(controller.signal);
          this.dependencies.records.update(operation.id, { status: "running" });
          const value = await input.execute(context);
          throwIfAborted(controller.signal);
          const resultPatch = input.postflight ? await input.postflight(value, context) : null;
          if (resultPatch) this.dependencies.records.update(operation.id, resultPatch);
          return value;
        },
        input.timeoutMs ?? timeoutMsForKind(input.kind),
        controller
      );
      this.dependencies.records.update(operation.id, {
        status: "succeeded",
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started
      });
      return result;
    } catch (error) {
      const normalizedError =
        controller.signal.aborted && !(error instanceof OperationTimeoutError) ? new OperationCancelledError() : error;
      const status = normalizedError instanceof OperationCancelledError ? "cancelled" : "failed";
      const code =
        normalizedError instanceof OperationTimeoutError
          ? "operation_timeout"
          : normalizedError instanceof OperationCancelledError
            ? "operation_cancelled"
            : errorCode(normalizedError, `${input.kind}_failed`);
      this.dependencies.records.update(operation.id, {
        status,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        errorCode: code,
        errorMessage: errorMessage(normalizedError)
      });
      if (status === "failed") {
        this.dependencies.diagnostics.recordDiagnosticEvent({
          source: "operation",
          level: "error",
          code,
          message: `${input.kind}: ${errorMessage(normalizedError)}`
        });
      }
      throw normalizedError;
    } finally {
      this.controllers.delete(operation.id);
      if (scopeKey && this.activeScopes.get(scopeKey) === operation.id) this.activeScopes.delete(scopeKey);
    }
  }
}

class OperationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Operation timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = "OperationTimeoutError";
  }
}

class OperationCancelledError extends Error {
  constructor() {
    super("Operation cancellation was requested.");
    this.name = "OperationCancelledError";
  }
}

async function withOperationDeadline<T>(task: () => Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  const taskPromise = task();
  let timedOut = false;
  try {
    return await Promise.race([
      taskPromise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
          void waitForTaskToSettle(taskPromise, 1_500).finally(() => reject(new OperationTimeoutError(timeoutMs)));
        }, timeoutMs);
        controller.signal.addEventListener(
          "abort",
          () => {
            if (timedOut) return;
            void waitForTaskToSettle(taskPromise, 1_500).finally(() => reject(new OperationCancelledError()));
          },
          { once: true }
        );
      })
    ]);
  } catch (error) {
    if (timedOut) throw new OperationTimeoutError(timeoutMs);
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForTaskToSettle(task: Promise<unknown>, graceMs: number): Promise<void> {
  await Promise.race([
    task.then(
      () => undefined,
      () => undefined
    ),
    new Promise<void>((resolve) => setTimeout(resolve, graceMs))
  ]);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new OperationCancelledError();
}

function timeoutMsForKind(kind: string): number {
  if (/^(stage|unstage)/.test(kind)) return 30_000;
  if (kind === "discard_file") return 60_000;
  if (/^(fetch_branch|pull_branch|push_branch|publish_branch)$/.test(kind)) return 180_000;
  if (kind === "open_merge_tool") return 300_000;
  if (kind === "switch_branch") return 180_000;
  if (/^(commit|revert|stash|apply_stash|pop_stash|drop_stash|apply_repo_identity)/.test(kind)) return 120_000;
  if (/^(pr_|issue_)/.test(kind)) return 60_000;
  return 90_000;
}

function isActiveOperationStatus(status: OperationRecord["status"]): boolean {
  return status === "queued" || status === "preflight" || status === "running";
}

function operationScopeKey<T>(
  input: OperationRunInput<T>,
  activeWorkspace: { id: string; localPath: string | null } | null
): string | null {
  if (!input.repoId) return null;
  const workspace = input.workspaceId ?? activeWorkspace?.id ?? input.workspacePath ?? activeWorkspace?.localPath ?? null;
  return workspace ? `${input.repoId}:workspace:${workspace}` : `${input.repoId}:repo`;
}
