import React from "react";
import type { RepoCommitSummary } from "../../../shared/domain/repo-code";
import { IdentityRiskNotice, RepoIdentityControl } from "../repo-identity/RepoIdentityControl";
import { formatRelative, shortSha } from "../../lib/format";
import { ConfirmDialog } from "../../components/ConfirmDialog";

export function RevertCommitDialog({
  repoId,
  commit,
  pending,
  onClose,
  onConfirm
}: {
  repoId: string;
  commit: RepoCommitSummary;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      title="Create local revert"
      objectName={`Revert ${shortSha(commit.sha)} into Local Changes.`}
      body={
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-900 bg-black/20 px-3 py-2">
            <span className="text-xs font-medium text-neutral-500">Acting as</span>
            <RepoIdentityControl repoId={repoId} compact allowApply={false} />
          </div>
          <IdentityRiskNotice repoId={repoId} action="git" />
          <div className="border-l border-neutral-800 pl-3">
            <div className="truncate text-sm font-medium text-neutral-200">{commit.message}</div>
            <div className="mt-2 flex items-center gap-2 text-xs text-neutral-600">
              <span className="font-mono">{shortSha(commit.sha)}</span>
              <span>/</span>
              <span>{commit.committedAt ? formatRelative(commit.committedAt) : "commit time unknown"}</span>
            </div>
          </div>

          <p className="text-sm leading-5 text-neutral-500">
            This will not create a commit yet. It will apply the inverse patch locally so you can review it in Local Changes.
          </p>
        </div>
      }
      confirmLabel="Create revert"
      pendingLabel="Creating..."
      pending={pending}
      onCancel={onClose}
      onConfirm={onConfirm}
    />
  );
}
