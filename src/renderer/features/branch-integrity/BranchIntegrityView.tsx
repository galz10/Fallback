import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Copy, Download, RefreshCcw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type { PullRequestDiff } from "../../../shared/domain/github-work";
import type { BranchIntegrityFinding } from "../../../shared/domain/branch-integrity";
import { branchIntegrityAutomaticAuditLimit } from "../../../shared/branch-integrity-config";
import { branchSafetyFindingCopy, branchSafetyReport } from "../../../shared/product-coherence";
import { fallbackSettings } from "../../app/default-settings";
import { Button, EmptyState, Surface } from "../../components/ui";
import { formatRelative, shortSha } from "../../lib/format";
import { DiffsCodeShell, PatchRenderBoundary } from "../../diffs/DiffShell";
import { PatchDiff } from "../../diffs/lazy-diffs";
import { diffsDiffOptions } from "../../diffs/options";
import { BranchIntegrityBadge } from "./BranchIntegrityBadge";

export function BranchIntegrityView({ repo }: { repo: WatchedRepo | null }) {
  const queryClient = useQueryClient();
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [diff, setDiff] = useState<PullRequestDiff | null>(null);
  const repoId = repo?.id ?? null;
  const { data: summary } = useQuery({
    queryKey: ["branchIntegritySummary", repoId],
    queryFn: () => window.fallback.branchIntegrity.summary(repoId!),
    enabled: Boolean(repoId),
    refetchInterval: 120_000
  });
  const { data: settings = fallbackSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: window.fallback.settings.get
  });
  const { data: findings = [] } = useQuery({
    queryKey: ["branchIntegrityFindings", repoId],
    queryFn: () => window.fallback.branchIntegrity.latestFindings(repoId!),
    enabled: Boolean(repoId),
    refetchInterval: 120_000
  });
  const openFindings = findings.filter((finding) => finding.status === "open");
  const selectedFinding = findings.find((finding) => finding.id === selectedFindingId) ?? openFindings[0] ?? findings[0] ?? null;
  const report = useMemo(() => branchSafetyReport(findings), [findings]);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["branchIntegritySummary", repoId] }),
      queryClient.invalidateQueries({ queryKey: ["branchIntegrityFindings", repoId] })
    ]);
  };
  const audit = useMutation({
    mutationFn: () => window.fallback.branchIntegrity.auditRepo(repoId!, { mode: "full", limit: branchIntegrityAutomaticAuditLimit }),
    onSuccess: async (result) => {
      toast.success(`Audited ${result.commitsAudited} first-parent commits.`);
      await refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  });
  const fetchRefs = useMutation({
    mutationFn: () => window.fallback.branchIntegrity.fetchSafetyRefs(repoId!),
    onSuccess: () => toast.success("Fetched refs/fallback safety refs."),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  });
  const resolve = useMutation({
    mutationFn: (id: string) => window.fallback.branchIntegrity.markResolved(id),
    onSuccess: refresh
  });
  const resolveAll = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => window.fallback.branchIntegrity.markResolved(id)));
      return ids.length;
    },
    onSuccess: async (count) => {
      setSelectedFindingId(null);
      setDiff(null);
      toast.success(`Resolved ${count} branch integrity ${count === 1 ? "finding" : "findings"}.`);
      await refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  });
  const inspectDiff = useMutation({
    mutationFn: ({ findingId, mode }: { findingId: string; mode: "landed" | "expected" }) =>
      window.fallback.branchIntegrity.inspectDiff(repoId!, findingId, mode),
    onSuccess: setDiff,
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  });
  const createRecoveryBranch = useMutation({
    mutationFn: (findingId: string) => window.fallback.branchIntegrity.createRecoveryBranch(repoId!, [findingId]),
    onSuccess: (result) => toast.success(`${result.recoveryBranchName} prepared for review.`),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  });
  const openRecoveryPr = useMutation({
    mutationFn: (findingId: string) => window.fallback.branchIntegrity.openRecoveryPullRequest(repoId!, [findingId]),
    onSuccess: (pr) => toast.success(`Recovery PR #${pr.number} opened.`),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error))
  });

  if (!repo) {
    return (
      <EmptyState
        title="Select a repository."
        detail="Branch Watch records snapshots during sync and helps inspect suspicious branch changes."
      />
    );
  }

  return (
    <div className="space-y-5">
      <Surface tone="subtle" className="p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-medium text-neutral-100">Branch Watch</h2>
              <BranchIntegrityBadge summary={summary} auditing={audit.isPending} />
            </div>
            <p className="mt-2 max-w-2xl text-sm text-neutral-500">
              Suspicious branch changes stay explainable with landed, expected, tested, and recovery evidence.
            </p>
            <div className="mt-4 grid gap-2 text-sm text-neutral-500 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Branch" value={summary?.branchName ?? repo.defaultBranch ?? "main"} />
              <Metric label="Head" value={summary?.headSha ? shortSha(summary.headSha) : "Waiting for first sync"} mono />
              <Metric label="Last snapshot" value={summary?.observedAt ? formatRelative(summary.observedAt) : "Waiting for first sync"} />
              <Metric label="Last audit" value={summary?.lastAuditAt ? formatRelative(summary.lastAuditAt) : "Not audited yet"} />
              <Metric label="Automatic audits" value={settings.branchIntegrity.automaticAuditAfterSync ? "On when head changes" : "Off"} />
              <Metric label="Background limit" value={`${branchIntegrityAutomaticAuditLimit} commits`} />
              <Metric label="Tree" value={summary?.treeSha ? shortSha(summary.treeSha) : "Waiting for snapshot"} mono />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => audit.mutate()} disabled={!repo.localPath || audit.isPending} variant="primary">
              <RefreshCcw className="h-4 w-4" />
              {audit.isPending ? "Auditing..." : "Run full audit"}
            </Button>
            <Button onClick={() => fetchRefs.mutate()} disabled={!repo.localPath || fetchRefs.isPending}>
              <Download className="h-4 w-4" />
              Fetch refs
            </Button>
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(report);
                toast.success("Branch Watch report copied.");
              }}
            >
              <Copy className="h-4 w-4" />
              Copy report
            </Button>
          </div>
        </div>
      </Surface>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <Surface tone="subtle" className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
            <div>
              <div className="font-medium text-neutral-100">Findings</div>
              <div className="text-xs text-neutral-500">
                {openFindings.length} open · {findings.length} total
              </div>
            </div>
            <Button
              size="xs"
              onClick={() => {
                if (!openFindings.length) return;
                if (window.confirm(`Resolve all ${openFindings.length} open branch integrity findings?`)) {
                  resolveAll.mutate(openFindings.map((finding) => finding.id));
                }
              }}
              disabled={openFindings.length === 0 || resolveAll.isPending}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {resolveAll.isPending ? "Resolving..." : "Resolve all"}
            </Button>
          </div>
          <div className="divide-y divide-neutral-800">
            {findings.map((finding) => (
              <button
                key={finding.id}
                type="button"
                onClick={() => setSelectedFindingId(finding.id)}
                className={`flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-neutral-900/70 ${
                  selectedFinding?.id === finding.id ? "bg-neutral-900" : ""
                }`}
              >
                <ShieldAlert className={`mt-0.5 h-4 w-4 shrink-0 ${severityClass(finding.severity)}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-neutral-100">{branchSafetyFindingCopy(finding).label}</span>
                  <span className="mt-1 line-clamp-2 block text-xs text-neutral-500">{branchSafetyFindingCopy(finding).whatHappened}</span>
                  <span className="mt-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-neutral-600">
                    <span>{finding.severity}</span>
                    <span>{finding.confidence}</span>
                    {finding.landedSha && <span className="font-mono normal-case tracking-normal">{shortSha(finding.landedSha)}</span>}
                  </span>
                </span>
                <span className="rounded-full border border-neutral-800 px-2 py-0.5 text-[11px] text-neutral-500">{finding.status}</span>
              </button>
            ))}
            {findings.length === 0 && (
              <EmptyState
                title="No findings yet."
                detail="Monitoring is active. Suspicious branch changes appear here with evidence and recovery paths."
              />
            )}
          </div>
        </Surface>

        <Surface tone="subtle" className="overflow-hidden">
          <div className="border-b border-neutral-800 px-5 py-4">
            <div className="font-medium text-neutral-100">Evidence</div>
            <div className="text-xs text-neutral-500">What happened, why it matters, evidence, and recovery.</div>
          </div>
          {selectedFinding ? (
            <FindingEvidence
              finding={selectedFinding}
              resolving={resolve.isPending}
              resolvingAll={resolveAll.isPending}
              inspecting={inspectDiff.isPending}
              recovering={createRecoveryBranch.isPending || openRecoveryPr.isPending}
              onInspect={(mode) => inspectDiff.mutate({ findingId: selectedFinding.id, mode })}
              onCreateRecovery={() => createRecoveryBranch.mutate(selectedFinding.id)}
              onOpenRecoveryPr={() => openRecoveryPr.mutate(selectedFinding.id)}
              onResolve={() => resolve.mutate(selectedFinding.id)}
            />
          ) : (
            <EmptyState title="No evidence selected." detail="Open suspicious branch changes appear here with recovery context." />
          )}
        </Surface>
      </div>
      {diff && (
        <Surface tone="subtle" className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
            <div>
              <div className="font-medium text-neutral-100">Suspicious branch diff</div>
              <div className="text-xs text-neutral-500">Local git diff evidence</div>
            </div>
            <Button onClick={() => setDiff(null)}>Close diff</Button>
          </div>
          {diff.patch.trim() ? (
            <DiffsCodeShell className="diffs-shell-fit rounded-none border-0 bg-black">
              <PatchRenderBoundary patch={diff.patch}>
                <PatchDiff patch={diff.patch} options={diffsDiffOptions} />
              </PatchRenderBoundary>
            </DiffsCodeShell>
          ) : (
            <EmptyState title="No diff changes." detail="The selected evidence pair has the same tree content." />
          )}
        </Surface>
      )}
    </div>
  );
}

function FindingEvidence({
  finding,
  resolving,
  resolvingAll,
  inspecting,
  recovering,
  onInspect,
  onCreateRecovery,
  onOpenRecoveryPr,
  onResolve
}: {
  finding: BranchIntegrityFinding;
  resolving: boolean;
  resolvingAll: boolean;
  inspecting: boolean;
  recovering: boolean;
  onInspect: (mode: "landed" | "expected") => void;
  onCreateRecovery: () => void;
  onOpenRecoveryPr: () => void;
  onResolve: () => void;
}) {
  const recovery = finding.recoveryPlan;
  const copy = branchSafetyFindingCopy(finding);
  return (
    <div className="space-y-4 p-5">
      <div>
        <h3 className="text-sm font-medium text-neutral-100">{copy.label}</h3>
        <p className="mt-1 text-sm text-neutral-500">{copy.whatHappened}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <BranchSafetyCopyBlock label="Why it matters" value={copy.whyItMatters} />
        <BranchSafetyCopyBlock label="Suggested recovery" value={copy.suggestedRecovery} />
      </div>
      <div className="grid gap-2 text-sm">
        <Metric label="Evidence" value={copy.evidenceLabel} />
        <Metric label="Urgency" value={copy.severityLabel} />
        <Metric label="Landed commit" value={finding.landedSha ? shortSha(finding.landedSha) : "Unknown"} mono />
        <Metric label="Expected SHA" value={finding.expectedSha ? shortSha(finding.expectedSha) : "Not available"} mono />
        <Metric label="Landed tree" value={finding.landedTreeSha ? shortSha(finding.landedTreeSha) : "Unknown"} mono />
        <Metric label="Expected tree" value={finding.expectedTreeSha ? shortSha(finding.expectedTreeSha) : "Not available"} mono />
        <Metric
          label="Pull requests"
          value={finding.prNumbers.length ? finding.prNumbers.map((number) => `#${number}`).join(", ") : "None parsed"}
        />
      </div>
      {recovery && (
        <div className="rounded-md border border-neutral-800 bg-black/40 p-3">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-neutral-500">Recovery plan</div>
          <div className="mt-2 text-sm text-neutral-200">{recovery.strategy.replaceAll("_", " ")}</div>
          <ol className="mt-3 space-y-2">
            {recovery.steps.map((step) => (
              <li key={`${step.type}:${step.title}`} className="text-xs text-neutral-500">
                <span className="text-neutral-300">{step.title}</span>
                {step.command && (
                  <code className="mt-1 block overflow-x-auto rounded bg-neutral-950 px-2 py-1 font-mono text-neutral-400">
                    {step.command}
                  </code>
                )}
                {step.body && <div className="mt-1">{step.body}</div>}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onInspect("landed")} disabled={inspecting}>
          Inspect landed diff
        </Button>
        <Button onClick={() => onInspect("expected")} disabled={inspecting || (!finding.expectedSha && !finding.expectedTreeSha)}>
          Inspect expected diff
        </Button>
        <Button onClick={onCreateRecovery} disabled={recovering || !recovery}>
          Create recovery branch
        </Button>
        <Button onClick={onOpenRecoveryPr} disabled={recovering || !recovery} variant="primary">
          Open recovery PR
        </Button>
        <Button onClick={onResolve} disabled={finding.status === "resolved" || resolving || resolvingAll}>
          {finding.status === "resolved" ? "Resolved" : resolving ? "Resolving..." : "Mark resolved"}
        </Button>
      </div>
    </div>
  );
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[0.12em] text-neutral-600">{label}</div>
      <div className={`mt-0.5 truncate text-neutral-300 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function BranchSafetyCopyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-black/30 p-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-neutral-600">{label}</div>
      <div className="mt-1 text-sm leading-5 text-neutral-300">{value}</div>
    </div>
  );
}

function severityClass(severity: BranchIntegrityFinding["severity"]): string {
  if (severity === "critical") return "text-red-400";
  if (severity === "high") return "text-orange-400";
  if (severity === "medium") return "text-amber-400";
  return "text-neutral-500";
}
