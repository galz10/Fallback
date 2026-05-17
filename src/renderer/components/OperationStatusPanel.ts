import React from "react";
import { Copy, RotateCcw, SearchCheck, X } from "lucide-react";
import {
  operationHasRecoveryEvidence,
  operationRecoveryCopy as sharedOperationRecoveryCopy,
  recoveryCommandBundle
} from "../../shared/operation-recovery.js";
import type { OperationRecord } from "../../shared/domain/operation.js";
import { operationSafetyCopy } from "../../shared/product-coherence.js";

interface OperationStatusPanelProps {
  operations: OperationRecord[];
  onCancel?: (operation: OperationRecord) => void;
  onCopyReport?: (operation: OperationRecord) => void;
  onDismiss?: (operation: OperationRecord) => void;
  onOpenDiagnostics?: (operation: OperationRecord) => void;
  onRetry?: (operation: OperationRecord) => void;
}

const activeStatuses = new Set<OperationRecord["status"]>(["queued", "preflight", "running"]);
const failedStatuses = new Set<OperationRecord["status"]>(["failed", "blocked", "cancelled"]);
const retryableKinds = new Set([
  "stage_all",
  "unstage_all",
  "stash",
  "stash_files",
  "fetch_branch",
  "pull_branch",
  "push_branch",
  "publish_branch",
  "abort_conflict",
  "open_merge_tool"
]);

export function OperationStatusPanel({
  operations,
  onCancel,
  onCopyReport,
  onDismiss,
  onOpenDiagnostics,
  onRetry
}: OperationStatusPanelProps) {
  const current = operations.filter((operation) => activeStatuses.has(operation.status)).slice(0, 1);
  const failed = operations.filter((operation) => failedStatuses.has(operation.status)).slice(0, 3);
  const visible = [...current, ...failed].slice(0, 4);
  if (visible.length === 0) return null;

  return React.createElement(
    "div",
    { className: "space-y-1.5" },
    visible.map((operation) => {
      const failedOperation = failedStatuses.has(operation.status);
      const succeededOperation = operation.status === "succeeded";
      const tone = operationStatusTone(operation);
      const safety = operationSafetyCopy(operation);
      const detail = [
        operation.redactedCommand,
        operationHasRecovery(operation) ? operationRecoveryCopy(operation) : null,
        operationHasResult(operation) ? operationResultCopy(operation) : null,
        failedOperation ? operationNextStep(operation) : null
      ]
        .filter(Boolean)
        .join(" ");
      return React.createElement(
        "div",
        {
          key: operation.id,
          className: `rounded-lg border px-3 py-2 text-xs ${tone.panel}`
        },
        React.createElement(
          "div",
          { className: "flex flex-wrap items-center justify-between gap-3" },
          React.createElement(
            "div",
            { className: "min-w-0 flex-1" },
            React.createElement(
              "div",
              { className: "flex min-w-0 items-center gap-2" },
              React.createElement("div", { className: "truncate font-medium" }, operation.commandSummary ?? operation.kind),
              React.createElement(
                "span",
                { className: `shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${tone.statusBadge}` },
                operation.status
              )
            ),
            React.createElement(
              "div",
              { className: `mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] ${tone.meta}` },
              React.createElement("span", null, operationDurationLabel(operation)),
              React.createElement("span", null, operation.riskLevel)
            )
          ),
          React.createElement(
            "div",
            { className: "flex shrink-0 items-center gap-1" },
            onRetry && operationCanRetry(operation)
              ? React.createElement(
                  IconButton,
                  { label: "Retry", onClick: () => onRetry(operation) },
                  React.createElement(RotateCcw, { className: "h-3.5 w-3.5" })
                )
              : null,
            onOpenDiagnostics && failedOperation
              ? React.createElement(
                  IconButton,
                  { label: "Diagnostics", onClick: () => onOpenDiagnostics(operation) },
                  React.createElement(SearchCheck, { className: "h-3.5 w-3.5" })
                )
              : null,
            onCopyReport && (failedOperation || succeededOperation)
              ? React.createElement(
                  IconButton,
                  { label: "Copy report", onClick: () => onCopyReport(operation) },
                  React.createElement(Copy, { className: "h-3.5 w-3.5" })
                )
              : null,
            onCancel && activeStatuses.has(operation.status)
              ? React.createElement(
                  IconButton,
                  { label: "Cancel", onClick: () => onCancel(operation) },
                  React.createElement(X, { className: "h-3.5 w-3.5" })
                )
              : null,
            onDismiss && failedOperation
              ? React.createElement(
                  IconButton,
                  { label: "Dismiss", onClick: () => onDismiss(operation) },
                  React.createElement(X, { className: "h-3.5 w-3.5" })
                )
              : null
          )
        ),
        operation.errorMessage
          ? React.createElement("div", { className: `mt-1.5 truncate text-xs ${tone.body}` }, operation.errorMessage)
          : null,
        detail ? React.createElement("div", { className: `mt-1.5 truncate font-mono text-[11px] ${tone.detail}` }, detail) : null,
        React.createElement(
          "div",
          { className: "mt-2 grid gap-1.5 text-[11px] sm:grid-cols-2" },
          React.createElement(SafetyLine, { label: "State", value: safety.state, tone }),
          React.createElement(SafetyLine, { label: "Risk", value: safety.risk, tone }),
          React.createElement(SafetyLine, { label: "Result", value: safety.result, tone }),
          React.createElement(SafetyLine, { label: "Recovery", value: safety.recovery, tone })
        )
      );
    })
  );
}

export function operationReport(operation: OperationRecord): string {
  return [
    `Operation: ${operation.commandSummary ?? operation.kind}`,
    `Kind: ${operation.kind}`,
    `Status: ${operation.status}`,
    `Risk: ${operation.riskLevel}`,
    `Duration: ${operationDurationLabel(operation)}`,
    `Repo: ${operation.repoFullName ?? operation.repoId ?? "unknown"}`,
    `Command: ${operation.redactedCommand ?? "not captured"}`,
    `Recovery: ${operationRecoveryCopy(operation) ?? "not captured"}`,
    `Recovery dirty: ${operation.recoveryIsDirty == null ? "unknown" : operation.recoveryIsDirty ? "yes" : "no"}`,
    `Recovery file count: ${operation.recoveryFileCount ?? "unknown"}`,
    `Recovery stashes: ${operation.recoveryStashRefs.length > 0 ? operation.recoveryStashRefs.join(", ") : "none"}`,
    `Recovery safety ref: ${operation.recoveryRef ?? "none"}`,
    `Recovery commands: ${recoveryCommandBundle(operation)}`,
    `Result: ${operationResultCopy(operation) ?? "not captured"}`,
    `Result stashes: ${operation.resultStashRefs.length > 0 ? operation.resultStashRefs.join(", ") : "none"}`,
    `Error code: ${operation.errorCode ?? "none"}`,
    `Error: ${operation.errorMessage ?? "none"}`,
    `Next step: ${operationNextStep(operation)}`
  ].join("\n");
}

export function operationCanRetry(operation: OperationRecord): boolean {
  return failedStatuses.has(operation.status) && retryableKinds.has(operation.kind);
}

export function operationNextStep(operation: OperationRecord): string {
  if (operation.recoveryHint) return operation.recoveryHint;
  if (operation.errorCode?.startsWith("github_auth_") || operation.errorCode === "github_auth") {
    return "Open diagnostics and reconnect or update the GitHub account before retrying.";
  }
  if (operation.errorCode?.startsWith("git_network_auth_failed")) {
    return "Open diagnostics and reconnect or update Git credentials before retrying.";
  }
  if (operation.errorCode === "git_network_non_fast_forward") {
    return "Fetch and pull the remote branch, resolve divergence if needed, then push again.";
  }
  if (operation.errorCode === "git_network_conflict") {
    return "Resolve the merge or rebase conflicts in the workspace, then continue or abort with Git.";
  }
  if (operation.errorCode?.startsWith("git_conflict_")) {
    return "Open the conflict panel, resolve or abort the active Git operation, then retry when the workspace is clean.";
  }
  if (operation.errorCode === "git_network_protected_branch") {
    return "Remote branch protection rejected the update. Publish a branch and open a pull request.";
  }
  if (operation.errorCode === "git_signing_failed") {
    const message = operation.errorMessage ?? "";
    if (/pinentry|inappropriate ioctl|agent refused/i.test(message)) {
      return "Commit signing failed because pinentry is unavailable. Repair the GPG agent or pinentry, verify signing, then retry the commit.";
    }
    if (/no secret key|secret key/i.test(message)) {
      return "Commit signing failed because the GPG secret key is unavailable. Choose an existing GPG key or import the matching secret key.";
    }
    if (/couldn'?t load public key|ssh signing key|user\.signingkey/i.test(message)) {
      return "Commit signing failed because the SSH signing key is not configured. Fix user.signingkey or choose an existing SSH public key.";
    }
    return "Commit signing failed. Check user.signingkey, gpg.format, gpg.program, and signing agent access, then verify signing.";
  }
  if (operation.errorCode === "operation_timeout") {
    return "Check whether Git is still busy, then retry the action when the workspace is responsive.";
  }
  if (operation.status === "cancelled") return "Retry the action when you are ready to continue.";
  return "Review diagnostics, fix the reported issue, then retry the action.";
}

export function operationRecoveryCopy(operation: OperationRecord): string | null {
  return sharedOperationRecoveryCopy(operation);
}

export function operationResultCopy(operation: OperationRecord): string | null {
  const summary = operation.resultSummary;
  const stashes =
    operation.resultStashRefs.length > 0
      ? `Created ${operation.resultStashRefs.length === 1 ? "stash" : "stashes"} ${operation.resultStashRefs.join(", ")}.`
      : null;
  return [summary, stashes].filter(Boolean).join(" ") || null;
}

export function operationDurationLabel(operation: OperationRecord): string {
  if (operation.durationMs != null) return formatDuration(operation.durationMs);
  if (!operation.startedAt) return "not started";
  const elapsed = Date.now() - Date.parse(operation.startedAt);
  return Number.isFinite(elapsed) ? `${formatDuration(elapsed)} elapsed` : "duration unknown";
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(0, durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

function operationHasRecovery(operation: OperationRecord): boolean {
  return operationHasRecoveryEvidence(operation) || operation.recoveryBranch != null || operation.recoveryIsDirty != null;
}

function operationHasResult(operation: OperationRecord): boolean {
  return Boolean(operation.resultSummary || operation.resultStashRefs.length > 0);
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children?: React.ReactNode }) {
  return React.createElement(
    "button",
    {
      type: "button",
      title: label,
      "aria-label": label,
      onClick,
      className:
        "grid h-7 w-7 place-items-center rounded-md border border-current/15 text-current opacity-80 transition hover:bg-white/10 hover:opacity-100"
    },
    children
  );
}

interface OperationStatusTone {
  panel: string;
  meta: string;
  statusBadge: string;
  body: string;
  detail: string;
  safetyLine: string;
  safetyLabel: string;
  safetyValue: string;
}

function operationStatusTone(operation: OperationRecord): OperationStatusTone {
  if (failedStatuses.has(operation.status)) {
    return {
      panel: "border-neutral-800 bg-[#0A0A0A] text-neutral-100 shadow-[0_1px_0_rgba(255,255,255,0.03)]",
      meta: "text-neutral-400",
      statusBadge: "border-red-500 bg-red-600 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)]",
      body: "text-neutral-100",
      detail: "text-neutral-300",
      safetyLine: "border-neutral-800 bg-[#050505]",
      safetyLabel: "text-neutral-400",
      safetyValue: "text-neutral-100"
    };
  }
  if (operation.status === "succeeded") {
    return {
      panel: "border-emerald-500/25 bg-emerald-950/25 text-emerald-100",
      meta: "text-emerald-200/80",
      statusBadge: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
      body: "text-emerald-50",
      detail: "text-emerald-100/80",
      safetyLine: "border-emerald-500/15 bg-black/20",
      safetyLabel: "text-emerald-200",
      safetyValue: "text-emerald-50/85"
    };
  }
  return {
    panel: "border-amber-500/25 bg-amber-950/25 text-amber-100",
    meta: "text-amber-200/80",
    statusBadge: "border-amber-500/25 bg-amber-500/10 text-amber-200",
    body: "text-amber-50",
    detail: "text-amber-100/80",
    safetyLine: "border-amber-500/15 bg-black/20",
    safetyLabel: "text-amber-200",
    safetyValue: "text-amber-50/85"
  };
}

function SafetyLine({ label, value, tone }: { label: string; value: string; tone: OperationStatusTone }) {
  return React.createElement(
    "div",
    { className: `min-w-0 rounded border px-2 py-1 ${tone.safetyLine}` },
    React.createElement("span", { className: `mr-1 font-medium ${tone.safetyLabel}` }, `${label}:`),
    React.createElement("span", { className: tone.safetyValue }, value)
  );
}
