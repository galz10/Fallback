import React from "react";
import type { RepoIdentity } from "../../../shared/domain/repo-identity";
import type { CommitTemplate } from "../../../shared/domain/local-git";
import type { CommitIdentityPolicyState } from "../../../shared/commit-identity-policy";
import { commitTemplateBody } from "../../../shared/commit-templates";
import { CommitIdentityWarningPanel } from "../../components/CommitIdentityWarningPanel";
import { CommitTemplateControls } from "../../components/CommitTemplateControls";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Textarea } from "../../components/ui/textarea";
import { CommitSigningStatePanel, RepoIdentityControl } from "../repo-identity/RepoIdentityControl";

export function CommitWorkflow({
  applyIdentityPending,
  busy,
  canCommit,
  commitDescription,
  commitIdentity,
  commitIdentityBypassed,
  commitIdentityState,
  commitPending,
  commitSummary,
  commitTemplates,
  filesCount,
  open,
  repoId,
  selectedTemplate,
  stagedCount,
  templateName,
  branch,
  commitBlockReason,
  onApplyIdentity,
  onApplyTemplate,
  onCommit,
  onCommitDescriptionChange,
  onCommitIdentityBypassedChange,
  onCommitSummaryChange,
  onOpenChange,
  onSaveTemplate,
  onSelectedTemplateIdChange,
  onTemplateNameChange
}: {
  applyIdentityPending: boolean;
  busy: boolean;
  canCommit: boolean;
  commitDescription: string;
  commitIdentity: RepoIdentity | null | undefined;
  commitIdentityBypassed: boolean;
  commitIdentityState: CommitIdentityPolicyState;
  commitPending: boolean;
  commitSummary: string;
  commitTemplates: CommitTemplate[];
  filesCount: number;
  open: boolean;
  repoId: string;
  selectedTemplate: CommitTemplate | null;
  stagedCount: number;
  templateName: string;
  branch: string;
  commitBlockReason: string | null;
  onApplyIdentity: () => void;
  onApplyTemplate: () => void;
  onCommit: () => void;
  onCommitDescriptionChange: (value: string) => void;
  onCommitIdentityBypassedChange: (bypassed: boolean) => void;
  onCommitSummaryChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSaveTemplate: () => void;
  onSelectedTemplateIdChange: (id: string) => void;
  onTemplateNameChange: (name: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,560px)] max-w-none gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-neutral-900 px-5 py-4">
          <DialogTitle>Commit changes</DialogTitle>
          <DialogDescription>
            {stagedCount}/{filesCount} staged to {branch}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <RepoIdentityControl repoId={repoId} labelMode="author" />
          <CommitIdentityWarningPanel
            state={commitIdentityState}
            bypassed={commitIdentityBypassed}
            applyPending={applyIdentityPending}
            onBypassChange={onCommitIdentityBypassedChange}
            onApplyIdentity={onApplyIdentity}
          />
          <CommitSigningStatePanel identity={commitIdentity} repoId={repoId} compact />
          <CommitTemplateControls
            templates={commitTemplates}
            selectedTemplateId={selectedTemplate?.id ?? ""}
            templateName={templateName}
            canApply={Boolean(selectedTemplate)}
            canSave={Boolean(commitTemplateBody(commitSummary, commitDescription))}
            busy={busy}
            onSelectedTemplateIdChange={onSelectedTemplateIdChange}
            onTemplateNameChange={onTemplateNameChange}
            onApply={onApplyTemplate}
            onSave={onSaveTemplate}
          />
          <Textarea
            value={commitSummary}
            onChange={(event) => onCommitSummaryChange(event.currentTarget.value)}
            placeholder="Commit summary"
            rows={1}
            className="block min-h-10 w-full resize-none rounded-md border border-neutral-800 bg-[#050505] px-3 py-2 text-[13px] font-medium leading-5 text-neutral-100 transition-colors placeholder:text-[13px] placeholder:font-normal placeholder:text-neutral-600 focus:border-neutral-600"
          />
          <Textarea
            value={commitDescription}
            onChange={(event) => onCommitDescriptionChange(event.currentTarget.value)}
            placeholder="Description"
            rows={5}
            className="block min-h-28 w-full resize-y rounded-md border border-neutral-800 bg-[#050505] px-3 py-2 text-[13px] leading-5 text-neutral-300 transition-colors placeholder:text-[13px] placeholder:text-neutral-600 focus:border-neutral-600"
          />
        </div>
        <DialogFooter className="border-t border-neutral-900 px-5 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy} className="text-[13px]">
            Cancel
          </Button>
          <Button
            onClick={onCommit}
            disabled={busy || !canCommit}
            title={commitBlockReason ?? "Commit staged changes"}
            className="bg-white text-black hover:bg-neutral-200 disabled:bg-neutral-900 disabled:text-neutral-600 disabled:opacity-100"
          >
            {commitPending ? "Committing..." : "Commit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
