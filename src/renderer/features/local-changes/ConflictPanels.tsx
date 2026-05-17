import { AlertTriangle, Copy, ExternalLink, RotateCcw, SearchCheck, Wrench } from "lucide-react";
import type React from "react";
import type { LocalGitConflictFile, LocalGitConflictPreflight, LocalGitConflictState } from "../../../shared/domain/local-git";
import { Button as UiButton } from "../../components/ui";

export function ConflictRiskPanel({
  risk,
  compact = false,
  onOpenLocalChanges,
  onFetch,
  onCopy
}: {
  risk: LocalGitConflictPreflight | null;
  compact?: boolean;
  onOpenLocalChanges?: () => void;
  onFetch?: () => void;
  onCopy?: () => void;
}) {
  if (!risk || risk.riskLevel === "none") return null;
  const high = risk.riskLevel === "high";
  return (
    <div className={`conflict-risk-panel ${high ? "conflict-risk-panel-high" : "conflict-risk-panel-warn"}`}>
      <div className="conflict-risk-panel-inner">
        <div className="conflict-risk-copy">
          <div className="conflict-risk-title-row">
            <span className="conflict-risk-icon" aria-hidden="true">
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
            <span className="conflict-risk-title">{risk.summary}</span>
          </div>
          <div className="conflict-risk-meta" aria-label="Conflict risk context">
            <RiskMeta value={risk.repoFullName} />
            <RiskMeta value={risk.branch ?? "detached"} />
            <RiskMeta value={risk.operation} />
            {risk.targetRef && <RiskMeta value={risk.targetRef} />}
            <RiskMeta value={`${risk.dirtyFileCount} dirty`} />
            <RiskMeta value={`${risk.overlappingFileCount} overlap`} />
            {risk.binaryFileCount > 0 && <RiskMeta value={`${risk.binaryFileCount} binary`} />}
            {risk.lfsFileCount > 0 && <RiskMeta value={`${risk.lfsFileCount} LFS`} />}
          </div>
        </div>
        <div className="conflict-risk-actions">
          {onOpenLocalChanges && (
            <IconAction label="Open diff" onClick={onOpenLocalChanges}>
              <SearchCheck className="h-3.5 w-3.5" />
            </IconAction>
          )}
          {onFetch && (
            <IconAction label="Fetch first" onClick={onFetch}>
              <RotateCcw className="h-3.5 w-3.5" />
            </IconAction>
          )}
          {onCopy && (
            <IconAction label="Copy diagnostics" onClick={onCopy}>
              <Copy className="h-3.5 w-3.5" />
            </IconAction>
          )}
        </div>
      </div>
      {!compact && risk.files.length > 0 && (
        <div className="conflict-risk-files">
          {risk.files.slice(0, 6).map((file) => (
            <RiskFileLine key={file.path} file={file} />
          ))}
        </div>
      )}
      {!compact && risk.safeAlternatives.length > 0 && (
        <div className="conflict-risk-alternatives">Safer paths: {risk.safeAlternatives.join(", ")}.</div>
      )}
    </div>
  );
}

export function ActiveConflictPanel({
  state,
  busy,
  onOpenFile,
  onOpenMergeTool,
  onAbort,
  onCopy
}: {
  state: LocalGitConflictState | null;
  busy: boolean;
  onOpenFile: (path: string) => void;
  onOpenMergeTool: (path: string) => void;
  onAbort: () => void;
  onCopy: () => void;
}) {
  if (!state?.isActive) return null;
  return (
    <div className="active-conflict-panel">
      <div className="active-conflict-header">
        <div className="active-conflict-summary">
          <div className="active-conflict-title-row">
            <AlertTriangle className="active-conflict-icon" />
            <span className="active-conflict-title">
              {state.operationLabel} conflict in {state.fileCount} {state.fileCount === 1 ? "file" : "files"}
            </span>
          </div>
          <div className="active-conflict-meta">
            <span>{state.repoFullName}</span>
            <span>{state.branch ?? "detached"}</span>
            <span>{state.workspacePath}</span>
            {state.binaryCount > 0 && <span>{state.binaryCount} binary</span>}
            {state.lfsCount > 0 && <span>{state.lfsCount} LFS</span>}
          </div>
        </div>
        <div className="active-conflict-actions">
          <IconAction label="Copy diagnostics" onClick={onCopy}>
            <Copy className="h-3.5 w-3.5" />
          </IconAction>
          <UiButton size="xs" variant="secondary" onClick={onAbort} disabled={busy} title="Abort active Git operation">
            Abort
          </UiButton>
        </div>
      </div>
      <div className="active-conflict-files">
        {state.files.map((file) => (
          <div key={file.path} className="active-conflict-file">
            <div className="active-conflict-file-row">
              <ConflictFileLine file={file} />
              <div className="active-conflict-file-actions">
                <IconAction label="Open file" onClick={() => onOpenFile(file.path)} disabled={busy}>
                  <ExternalLink className="h-3.5 w-3.5" />
                </IconAction>
                <IconAction label="Open merge tool" onClick={() => onOpenMergeTool(file.path)} disabled={busy}>
                  <Wrench className="h-3.5 w-3.5" />
                </IconAction>
              </div>
            </div>
            {file.cue && <div className="active-conflict-cue">{file.cue}</div>}
          </div>
        ))}
      </div>
      {state.recoveryHint && <div className="active-conflict-recovery">{state.recoveryHint}</div>}
    </div>
  );
}

export function conflictReport(state: LocalGitConflictState | LocalGitConflictPreflight): string {
  if ("riskLevel" in state) {
    return [
      `Conflict risk: ${state.riskLevel}`,
      `Repo: ${state.repoFullName}`,
      `Workspace: ${state.workspacePath}`,
      `Branch: ${state.branch ?? "detached"}`,
      `Operation: ${state.operation}`,
      `Target: ${state.targetRef ?? "none"}`,
      `Summary: ${state.summary}`,
      `Dirty files: ${state.dirtyFileCount}`,
      `Overlapping files: ${state.overlappingFileCount}`,
      `Binary files: ${state.binaryFileCount}`,
      `LFS files: ${state.lfsFileCount}`,
      `Files: ${state.files.map((file) => file.path).join(", ") || "none"}`
    ].join("\n");
  }
  return [
    `Conflict state: ${state.state}`,
    `Repo: ${state.repoFullName}`,
    `Workspace: ${state.workspacePath}`,
    `Branch: ${state.branch ?? "detached"}`,
    `Files: ${state.fileCount}`,
    `Binary files: ${state.binaryCount}`,
    `LFS files: ${state.lfsCount}`,
    `Conflicted paths: ${state.files.map((file) => `${file.path} (${file.status})`).join(", ") || "none"}`,
    `Recovery: ${state.recoveryHint ?? "none"}`
  ].join("\n");
}

function ConflictFileLine({ file }: { file: Pick<LocalGitConflictFile, "path" | "status" | "isBinary" | "isLfsPointer" | "cue"> }) {
  return (
    <div className="active-conflict-file-main">
      <span className="active-conflict-file-path">{file.path}</span>
      <span className="active-conflict-file-badge">{file.status}</span>
      {file.isBinary && <span className="active-conflict-file-badge active-conflict-file-badge-danger">binary</span>}
      {file.isLfsPointer && <span className="active-conflict-file-badge active-conflict-file-badge-danger">LFS</span>}
    </div>
  );
}

function RiskFileLine({
  file
}: {
  file: { path: string; dirty: boolean; touchedByTarget: boolean; isBinary: boolean; isLfsPointer: boolean; cue: string | null };
}) {
  return (
    <div className="conflict-risk-file-line">
      <span className="conflict-risk-file-path">{file.path}</span>
      {file.dirty && <span className="conflict-risk-file-badge">dirty</span>}
      {file.touchedByTarget && <span className="conflict-risk-file-badge">target</span>}
      {file.isBinary && <span className="conflict-risk-file-badge conflict-risk-file-badge-danger">binary</span>}
      {file.isLfsPointer && <span className="conflict-risk-file-badge conflict-risk-file-badge-danger">LFS</span>}
    </div>
  );
}

function RiskMeta({ value }: { value: string }) {
  return <span className="conflict-risk-meta-item">{value}</span>;
}

function IconAction({
  label,
  onClick,
  disabled = false,
  children
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="conflict-risk-icon-action">
      {children}
    </button>
  );
}
