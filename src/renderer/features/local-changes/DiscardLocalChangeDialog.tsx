import React from "react";
import type { LocalChangeFile } from "../../../shared/domain/local-git";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { IdentityRiskNotice, RepoIdentityControl } from "../repo-identity/RepoIdentityControl";

export function DiscardLocalChangeDialog({
  repoId,
  file,
  pending,
  onClose,
  onConfirm
}: {
  repoId: string;
  file: LocalChangeFile;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      title="Discard local changes?"
      objectName={file.path}
      body={
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-900 bg-black/20 px-3 py-2">
            <span className="text-xs font-medium text-neutral-500">Acting as</span>
            <RepoIdentityControl repoId={repoId} compact allowApply={false} />
          </div>
          <IdentityRiskNotice repoId={repoId} action="git" />
          <p>This will restore the file to the current branch and remove any uncommitted edits for this path.</p>
          <div className="flex items-center gap-2 font-mono text-xs text-neutral-600">
            {file.additions > 0 && <span className="text-emerald-500">+{file.additions}</span>}
            {file.deletions > 0 && <span className="text-red-500">-{file.deletions}</span>}
            {file.staged && <span>/ staged</span>}
            {file.unstaged && <span>/ unstaged</span>}
          </div>
        </div>
      }
      confirmLabel="Discard changes"
      pendingLabel="Discarding..."
      pending={pending}
      onCancel={onClose}
      onConfirm={onConfirm}
    />
  );
}
