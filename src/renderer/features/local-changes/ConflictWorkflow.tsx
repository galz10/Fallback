import React from "react";
import type { LocalGitConflictPreflight, LocalGitConflictState } from "../../../shared/domain/local-git";
import { ActiveConflictPanel, ConflictRiskPanel } from "./ConflictPanels";

export function ConflictWorkflow({
  busy,
  conflictState,
  stashConflictRisk,
  onAbort,
  onCopy,
  onOpenFile,
  onOpenMergeTool
}: {
  busy: boolean;
  conflictState: LocalGitConflictState | null | undefined;
  stashConflictRisk: LocalGitConflictPreflight | null | undefined;
  onAbort: () => void;
  onCopy: () => void;
  onOpenFile: (path: string) => void;
  onOpenMergeTool: (path: string) => void;
}) {
  return (
    <>
      <ActiveConflictPanel
        state={conflictState ?? null}
        busy={busy}
        onOpenFile={onOpenFile}
        onOpenMergeTool={onOpenMergeTool}
        onAbort={onAbort}
        onCopy={onCopy}
      />
      <ConflictRiskPanel risk={stashConflictRisk ?? null} onCopy={onCopy} />
    </>
  );
}
