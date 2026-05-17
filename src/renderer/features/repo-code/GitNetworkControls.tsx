import { useMemo, useState, type ButtonHTMLAttributes } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownToLine, Download, GitBranch, SearchCheck, Upload } from "lucide-react";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type { CredentialDiagnosticReport } from "../../../shared/domain/repo-identity";
import type { LocalGitNetworkPreflight, LocalGitPullStrategy } from "../../../shared/domain/local-git";
import type { OperationRecord } from "../../../shared/domain/operation";
import { invalidateGitNetworkFreshness, rendererQueryKeys } from "../../app/query-freshness";
import { Button as UiButton, Surface } from "../../components/ui";
import { CredentialDiagnosticsDialog } from "../../components/CredentialDiagnosticsDialog";
import { OperationStatusPanel, operationReport } from "../../components/OperationStatusPanel";
import { useNavigationStore } from "../../state/navigation-store";
import { useRepoSelectionStore } from "../../state/repo-selection-store";
import { ConflictRiskPanel, conflictReport } from "../local-changes/ConflictPanels";

const networkOperationKinds = new Set(["fetch_branch", "pull_branch", "push_branch", "publish_branch"]);

export function GitNetworkControls({ repo }: { repo: WatchedRepo }) {
  const queryClient = useQueryClient();
  const setView = useNavigationStore((state) => state.setView);
  const setSelectedRepoId = useRepoSelectionStore((state) => state.setSelectedRepoId);
  const [diagnosticsReport, setDiagnosticsReport] = useState<CredentialDiagnosticReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const preflightQuery = useQuery({
    queryKey: ["gitNetworkPreflight", repo.id],
    queryFn: () => window.fallback.repos.gitNetworkPreflight(repo.id),
    enabled: Boolean(repo.localPath),
    staleTime: 10_000
  });
  const operationsQuery = useQuery({
    queryKey: ["operations", repo.id],
    queryFn: () => window.fallback.operations.listRecent(repo.id),
    enabled: Boolean(repo.localPath),
    refetchInterval: (query) => (query.state.data?.some((operation) => isActiveNetworkOperation(operation)) ? 1500 : false)
  });
  const conflictRiskQuery = useQuery({
    queryKey: ["conflictRisk", repo.id, "pull", preflightQuery.data?.upstream],
    queryFn: () =>
      window.fallback.repos.conflictPreflight(repo.id, { operation: "pull", targetRef: preflightQuery.data?.upstream ?? null }),
    enabled: Boolean(repo.localPath && preflightQuery.data?.upstream),
    staleTime: 10_000
  });
  const recentNetworkOperations = useMemo(
    () => (operationsQuery.data ?? []).filter((operation) => networkOperationKinds.has(operation.kind)).slice(0, 4),
    [operationsQuery.data]
  );
  const diagnostics = useMutation({
    mutationFn: () => window.fallback.repos.checkCredentials(repo.id),
    onSuccess: (report) => setDiagnosticsReport(report),
    onError: (error) => setNotice(errorMessage(error))
  });
  const runNetworkOperation = useMutation({
    mutationFn: async (input: { action: "fetch" | "pull" | "push" | "publish"; strategy?: LocalGitPullStrategy }) => {
      if (input.action === "fetch") return window.fallback.repos.fetchWorkspace(repo.id);
      if (input.action === "pull") return window.fallback.repos.pullWorkspace(repo.id, { strategy: input.strategy ?? "ff-only" });
      if (input.action === "push") return window.fallback.repos.pushWorkspace(repo.id);
      return window.fallback.repos.publishWorkspace(repo.id);
    },
    onSuccess: async (result) => {
      setNotice(result.message);
      await invalidateGitNetworkFreshness(queryClient, repo.id);
    },
    onError: async (error) => {
      setNotice(errorMessage(error));
      await invalidateGitNetworkFreshness(queryClient, repo.id);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: rendererQueryKeys.operations(repo.id) });
    }
  });
  const cancelOperation = useMutation({
    mutationFn: (operationId: string) => window.fallback.operations.cancel(operationId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: rendererQueryKeys.operations(repo.id) })
  });
  const preflight = preflightQuery.data ?? null;
  const networkMeta = buildNetworkMeta(preflight, repo);
  const networkDetailsTitle = buildNetworkDetailsTitle(preflight, repo);
  const busy = runNetworkOperation.isPending || recentNetworkOperations.some((operation) => isActiveNetworkOperation(operation));
  const disabledReason = syncDisabledReason(preflight, preflightQuery.isLoading);
  const showDiagnosticsAction = Boolean(preflight?.credentialStatus && preflight.credentialStatus !== "ok");
  const showSecondaryStatus = Boolean(preflight?.signingPolicyHint);
  const showPublishAction = preflight?.hasUpstream === false || preflight?.status === "no_upstream";
  const openLocalChanges = () => {
    setSelectedRepoId(repo.id);
    setView("Local Changes");
  };
  const copyConflictRisk = async () => {
    if (!conflictRiskQuery.data) return;
    await copyText(conflictReport(conflictRiskQuery.data));
    setNotice("Copied conflict risk report.");
  };
  const runPull = () => {
    const risk = conflictRiskQuery.data;
    if (
      risk &&
      (risk.riskLevel === "high" || risk.riskLevel === "medium") &&
      !window.confirm(
        `${risk.summary}\n\nOverlapping files: ${risk.overlappingFileCount}\nDirty files: ${risk.dirtyFileCount}\n\nPull anyway?`
      )
    ) {
      return;
    }
    runNetworkOperation.mutate({ action: "pull", strategy: "ff-only" });
  };
  if (!repo.localPath) return null;

  return (
    <Surface className="git-network-panel">
      {diagnosticsReport && <CredentialDiagnosticsDialog report={diagnosticsReport} onClose={() => setDiagnosticsReport(null)} />}
      <div className="git-network-header">
        <div className="git-network-context">
          <div className="git-network-title-row">
            <span className="git-network-icon" aria-hidden="true">
              <GitBranch className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <div className="git-network-title-line">
                <div className="git-network-title" title={repo.fullName}>
                  {repo.fullName}
                </div>
                <GitNetworkStatusPill preflight={preflight} loading={preflightQuery.isLoading} />
              </div>
              <div className="git-network-meta-line" title={networkDetailsTitle} aria-label="Git sync context">
                {networkMeta.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>
          </div>
          {showSecondaryStatus && (
            <div className="git-network-status-row">
              {preflight?.signingPolicyHint && <span className="git-network-hint">{preflight.signingPolicyHint}</span>}
            </div>
          )}
        </div>
        <div className="git-network-actions" aria-label="Git sync actions">
          {showDiagnosticsAction && (
            <GitNetworkActionButton
              label={diagnostics.isPending ? "Diagnosing GitHub credentials" : "Diagnose GitHub credentials"}
              title={diagnostics.isPending ? "Diagnosing GitHub credentials" : "Diagnose GitHub credentials"}
              onClick={() => diagnostics.mutate()}
              disabled={diagnostics.isPending}
              className="git-network-action-diagnostics"
            >
              <SearchCheck className="h-3.5 w-3.5" />
            </GitNetworkActionButton>
          )}
          <UiButton
            size="xs"
            variant="secondary"
            onClick={() => runNetworkOperation.mutate({ action: "fetch" })}
            disabled={busy || preflightQuery.isLoading}
            title={preflight?.actionLabels.fetch ?? "Fetch remote refs"}
            aria-label={preflight?.actionLabels.fetch ?? "Fetch remote refs"}
            className="git-network-action-button"
          >
            <Download className="h-3.5 w-3.5" />
          </UiButton>
          <UiButton
            size="xs"
            variant="secondary"
            onClick={runPull}
            disabled={busy || Boolean(disabledReason) || preflight?.status === "no_upstream"}
            title={disabledReason ?? preflight?.actionLabels.pull ?? "Pull with --ff-only"}
            aria-label={disabledReason ?? preflight?.actionLabels.pull ?? "Pull with --ff-only"}
            className="git-network-action-button"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </UiButton>
          <UiButton
            size="xs"
            variant="secondary"
            onClick={() => runNetworkOperation.mutate({ action: "push" })}
            disabled={busy || preflightQuery.isLoading || preflight?.status === "detached" || preflight?.status === "no_upstream"}
            title={
              preflight?.status === "no_upstream"
                ? "Publish branch first"
                : (preflight?.branchProtectionHint ?? preflight?.actionLabels.push ?? "Push current branch")
            }
            aria-label={
              preflight?.status === "no_upstream"
                ? "Publish branch first"
                : (preflight?.branchProtectionHint ?? preflight?.actionLabels.push ?? "Push current branch")
            }
            className="git-network-action-button"
          >
            <Upload className="h-3.5 w-3.5" />
          </UiButton>
          {showPublishAction && (
            <UiButton
              size="xs"
              variant="secondary"
              onClick={() => runNetworkOperation.mutate({ action: "publish" })}
              disabled={busy || preflightQuery.isLoading || preflight?.status === "detached"}
              title={preflight?.actionLabels.publish ?? "Publish this branch and set upstream"}
              aria-label={preflight?.actionLabels.publish ?? "Publish this branch and set upstream"}
              className="git-network-action-button"
            >
              <Upload className="h-3.5 w-3.5" />
            </UiButton>
          )}
        </div>
      </div>
      {notice && (
        <div className="git-network-notice">
          <span className="truncate">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="git-network-notice-dismiss">
            Dismiss
          </button>
        </div>
      )}
      {conflictRiskQuery.data && conflictRiskQuery.data.riskLevel !== "none" && (
        <div className="mt-3">
          <ConflictRiskPanel
            risk={conflictRiskQuery.data}
            compact
            onOpenLocalChanges={openLocalChanges}
            onFetch={() => runNetworkOperation.mutate({ action: "fetch" })}
            onCopy={copyConflictRisk}
          />
        </div>
      )}
      {recentNetworkOperations.length > 0 && (
        <div className="mt-3">
          <OperationStatusPanel
            operations={recentNetworkOperations}
            onCancel={(operation) => cancelOperation.mutate(operation.id)}
            onCopyReport={(operation) => void copyText(operationReport(operation))}
            onOpenDiagnostics={() => diagnostics.mutate()}
            onRetry={(operation) => retryNetworkOperation(operation, (input) => runNetworkOperation.mutate(input))}
          />
        </div>
      )}
    </Surface>
  );
}

function GitNetworkActionButton({
  label,
  className,
  ...props
}: {
  label: string;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <UiButton size="xs" variant="secondary" aria-label={label} className={`git-network-action-button ${className ?? ""}`} {...props} />
  );
}

export function GitNetworkStatusPill({ preflight, loading }: { preflight: LocalGitNetworkPreflight | null; loading: boolean }) {
  const status = preflight?.status ?? "unknown";
  const tone = gitNetworkStatusTone(status);
  return (
    <span className={`git-network-status-pill ${tone}`} title={preflight?.statusMessage}>
      {status === "auth_failed" || status === "rejected" || status === "protected_branch" ? (
        <AlertTriangle className="h-3.5 w-3.5" />
      ) : null}
      {loading ? "Checking" : compactStatusMessage(preflight)}
    </span>
  );
}

function buildNetworkMeta(preflight: LocalGitNetworkPreflight | null, repo: WatchedRepo): string[] {
  const branch = preflight?.branch ?? "unknown branch";
  const upstream = preflight?.upstream ?? (preflight?.hasUpstream === false ? "no upstream" : null);
  const remote = preflight?.remoteProtocol ?? null;
  const meta = [branch, upstream, remote].filter((item): item is string => Boolean(item));
  return meta.length > 0 ? meta : [repo.fullName];
}

function buildNetworkDetailsTitle(preflight: LocalGitNetworkPreflight | null, repo: WatchedRepo): string {
  const workspace = preflight?.workspacePath ?? repo.localPath;
  const identity = preflight?.identityLabel ?? "Identity unknown";
  const remote = preflight?.remoteUrl ?? "Remote unknown";
  return [`Workspace ${workspace}`, `Identity ${identity}`, remote].join(" · ");
}

function compactStatusMessage(preflight: LocalGitNetworkPreflight | null): string {
  if (!preflight) return "Unavailable";
  if (preflight.status === "up_to_date" || preflight.status === "ready") return "Up to date";
  if (preflight.status === "ahead") return `${preflight.ahead ?? 0} ahead`;
  if (preflight.status === "behind") return `${preflight.behind ?? 0} behind`;
  if (preflight.status === "diverged") return `${preflight.ahead ?? 0} ahead, ${preflight.behind ?? 0} behind`;
  if (preflight.status === "dirty_worktree") return "Local changes";
  if (preflight.status === "no_upstream") return "No upstream";
  if (preflight.status === "remote_unavailable") return "Remote unavailable";
  if (preflight.status === "auth_failed") return "Auth failed";
  if (preflight.status === "protected_branch") return "Protected branch";
  if (preflight.status === "non_fast_forward") return "Non-fast-forward";
  return preflight.statusMessage;
}

export function gitNetworkStatusTone(status: string): string {
  if (["auth_failed", "protected_branch", "rejected", "non_fast_forward", "conflict", "remote_unavailable"].includes(status)) {
    return "git-network-status-pill-danger git-network-status-red";
  }
  if (["dirty_worktree", "diverged", "behind", "stale", "offline", "no_upstream"].includes(status)) {
    return "git-network-status-pill-warn git-network-status-amber";
  }
  if (["ahead", "up_to_date", "ready"].includes(status)) {
    return "git-network-status-pill-good git-network-status-emerald";
  }
  return "git-network-status-pill-neutral";
}

function syncDisabledReason(preflight: LocalGitNetworkPreflight | null, loading: boolean): string | null {
  if (loading) return "Checking Git preflight.";
  if (!preflight) return "Git preflight is unavailable.";
  if (preflight.status === "detached") return "Switch to a branch before pulling.";
  if (preflight.status === "dirty_worktree") return "Commit, stash, or discard local changes before pulling.";
  return null;
}

function isActiveNetworkOperation(operation: OperationRecord): boolean {
  return networkOperationKinds.has(operation.kind) && ["queued", "preflight", "running"].includes(operation.status);
}

function retryNetworkOperation(operation: OperationRecord, run: (input: { action: "fetch" | "pull" | "push" | "publish" }) => void): void {
  if (operation.kind === "fetch_branch") run({ action: "fetch" });
  if (operation.kind === "pull_branch") run({ action: "pull" });
  if (operation.kind === "push_branch") run({ action: "push" });
  if (operation.kind === "publish_branch") run({ action: "publish" });
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
