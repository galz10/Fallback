import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Code2, GitBranch, GitFork, Plus, RefreshCcw, Terminal, Trash2 } from "lucide-react";
import type { RepoWorkspace, WatchedRepo } from "../../../shared/domain/watched-repo";
import { workspaceProductCopy } from "../../../shared/product-coherence";
import { invalidateWorkspaceFreshness } from "../../app/query-freshness";
import { Button as UiButton } from "../../components/ui";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { cn } from "../../lib/utils";
import { formatDate, formatRelative } from "../../lib/format";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortSha(value: string | null): string {
  return value ? value.slice(0, 7) : "no HEAD";
}

function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value;
}

function workspaceCanOpen(workspace: RepoWorkspace): boolean {
  return !workspace.missing && !workspace.prunable && !workspace.bare;
}

function removalFallback(workspaces: RepoWorkspace[] | undefined, workspace: RepoWorkspace): RepoWorkspace | null {
  if (!workspace.isActive) return null;
  return (
    workspaces?.find((candidate) => candidate.id !== workspace.id && candidate.kind === "clone" && workspaceCanOpen(candidate)) ??
    workspaces?.find((candidate) => candidate.id !== workspace.id && workspaceCanOpen(candidate)) ??
    null
  );
}

function removeConfirmation(workspace: RepoWorkspace, replacement: RepoWorkspace | null): string {
  const copy = workspaceProductCopy(workspace);
  const details = [
    workspace.isActive && replacement ? `Fallback will switch to ${basename(replacement.localPath)} first.` : null,
    workspace.isDirty ? "This workspace has local changes. Git will be asked to force remove it." : null,
    workspace.locked ? "This workspace is locked. Git will be asked to force remove it." : null,
    copy.cleanupDetail
  ].filter(Boolean);
  return [
    "Remove parallel workspace?",
    "",
    workspace.localPath,
    ...(details.length ? ["", ...details] : []),
    "",
    "This removes the registered parallel workspace directory from disk."
  ].join("\n");
}

export function WorkspaceSelector({ repo }: { repo: WatchedRepo }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [baseRef, setBaseRef] = useState(repo.defaultBranch ?? "HEAD");
  const [createBranch, setCreateBranch] = useState(true);

  const workspaces = useQuery({
    queryKey: ["repoWorkspaces", repo.id],
    queryFn: () => window.fallback.repos.listWorkspaces(repo.id),
    enabled: Boolean(repo.localPath),
    staleTime: 15_000
  });
  const activeWorkspace = useMemo(() => workspaces.data?.find((workspace) => workspace.isActive), [workspaces.data]);

  const refresh = useMutation({
    mutationFn: () => window.fallback.repos.refreshWorkspaces(repo.id),
    onSuccess: () => invalidateWorkspaceFreshness(queryClient, repo.id)
  });
  const switchWorkspace = useMutation({
    mutationFn: async (workspaceId: string) => {
      const risk = await window.fallback.repos.conflictPreflight(repo.id, { operation: "workspace_switch" });
      if (
        (risk.riskLevel === "high" || risk.riskLevel === "medium") &&
        !window.confirm(
          `${risk.summary}\n\nRepo: ${risk.repoFullName}\nWorkspace: ${risk.workspacePath}\nBranch: ${risk.branch ?? "detached"}\nDirty files: ${risk.dirtyFileCount}\n\nSwitch workspaces anyway?`
        )
      ) {
        throw new Error("Workspace switch cancelled after conflict-risk preflight.");
      }
      return window.fallback.repos.switchWorkspace(repo.id, workspaceId);
    },
    onSuccess: async () => {
      setOpen(false);
      await invalidateWorkspaceFreshness(queryClient, repo.id);
    }
  });
  const createWorkspace = useMutation({
    mutationFn: () =>
      window.fallback.repos.createWorkspace(repo.id, {
        branchName: branchName.trim() || undefined,
        baseRef: baseRef.trim() || undefined,
        createBranch
      }),
    onSuccess: async () => {
      setBranchName("");
      setOpen(false);
      await invalidateWorkspaceFreshness(queryClient, repo.id);
    }
  });
  const removeWorkspace = useMutation({
    mutationFn: async (input: { workspace: RepoWorkspace; force: boolean; fallbackWorkspaceId?: string }) => {
      if (input.fallbackWorkspaceId) await window.fallback.repos.switchWorkspace(repo.id, input.fallbackWorkspaceId);
      return window.fallback.repos.removeWorkspace(repo.id, input.workspace.id, { force: input.force });
    },
    onSuccess: async () => {
      await invalidateWorkspaceFreshness(queryClient, repo.id);
    }
  });
  const pruneWorkspaces = useMutation({
    mutationFn: () => window.fallback.repos.pruneWorkspaces(repo.id),
    onSuccess: () => invalidateWorkspaceFreshness(queryClient, repo.id)
  });

  const busy =
    refresh.isPending || switchWorkspace.isPending || createWorkspace.isPending || removeWorkspace.isPending || pruneWorkspaces.isPending;
  const failure = refresh.error || switchWorkspace.error || createWorkspace.error || removeWorkspace.error || pruneWorkspaces.error;
  const workspaceCount = workspaces.data?.length ?? 0;

  if (!repo.localPath) return null;
  const confirmPrune = () => {
    if (
      window.confirm(
        "Prune stale workspaces?\n\nFallback will run git worktree prune for this repository. Git only removes stale workspace metadata for paths it considers prunable; it will not remove active workspace directories."
      )
    ) {
      pruneWorkspaces.mutate();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group flex max-w-[260px] cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-neutral-300 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          aria-expanded={open}
          title={activeWorkspace?.localPath ?? repo.localPath}
        >
          <GitFork className="h-3.5 w-3.5 shrink-0 text-neutral-500 transition-colors group-hover:text-neutral-300" />
          <span className="truncate font-medium">{activeWorkspace ? basename(activeWorkspace.localPath) : "workspace"}</span>
          {activeWorkspace?.isDirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />}
          <ChevronDown className="h-3 w-3 shrink-0 text-neutral-500 transition-colors group-hover:text-neutral-300" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[360px] overflow-hidden rounded-md border-white/10 bg-[#080808] p-0 text-neutral-100 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
      >
        <div className="flex h-9 items-center justify-between border-b border-white/[0.08] px-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-[13px] font-medium leading-none text-neutral-100">Workspaces</div>
            <div className="text-[11px] leading-none text-neutral-600">{workspaceCount || 0}</div>
          </div>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-600 transition enabled:hover:bg-white/[0.05] enabled:hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:opacity-40"
            title="Refresh workspaces"
            aria-label="Refresh workspaces"
            disabled={busy}
            onClick={() => refresh.mutate()}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="max-h-[300px] overflow-y-auto p-1">
          {workspaces.isFetching && !workspaces.data && <div className="px-2 py-3 text-[13px] text-neutral-500">Loading workspaces...</div>}
          {workspaces.data?.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              busy={busy}
              canRemoveWorkspace={
                workspace.kind === "worktree" &&
                workspaceCanOpen(workspace) &&
                (!workspace.isActive || Boolean(removalFallback(workspaces.data, workspace)))
              }
              onSwitch={() => switchWorkspace.mutate(workspace.id)}
              onOpenWindow={() =>
                void window.fallback.window.openContext({
                  repoId: repo.id,
                  workspaceId: workspace.id,
                  view: "Code",
                  selectedEntityId: "code:Files"
                })
              }
              onOpenEditor={() => void window.fallback.shell.openEditorAtLine(workspace.localPath, null, workspace.localPath)}
              onOpenTerminal={() => void window.fallback.shell.openTerminal(workspace.localPath)}
              onRemove={() => {
                const fallbackWorkspace = removalFallback(workspaces.data, workspace);
                if (window.confirm(removeConfirmation(workspace, fallbackWorkspace))) {
                  removeWorkspace.mutate({
                    workspace,
                    force: Boolean(workspace.isDirty || workspace.locked),
                    fallbackWorkspaceId: fallbackWorkspace?.id
                  });
                }
              }}
            />
          ))}
        </div>

        <div className="border-t border-white/[0.08] p-2">
          <div className="flex h-8 min-w-0 items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.025] px-1.5">
            <input
              className="h-full min-w-0 flex-1 border-0 bg-transparent px-1 text-[12px] text-neutral-100 outline-none placeholder:text-neutral-600 focus-visible:ring-0"
              value={branchName}
              onChange={(event) => setBranchName(event.currentTarget.value)}
              placeholder="branch"
              aria-label="New workspace branch"
              name="workspace-branch"
            />
            <div className="h-4 w-px shrink-0 bg-white/[0.08]" />
            <input
              className="h-full w-[5.25rem] border-0 bg-transparent px-1 font-mono text-[12px] text-neutral-300 outline-none placeholder:text-neutral-600 focus-visible:ring-0"
              value={baseRef}
              onChange={(event) => setBaseRef(event.currentTarget.value)}
              placeholder="base"
              aria-label="New workspace base ref"
              name="workspace-base-ref"
            />
            <label className="group/branch-toggle shrink-0">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={createBranch}
                onChange={(event) => setCreateBranch(event.currentTarget.checked)}
              />
              <span className="inline-flex h-6 cursor-pointer select-none items-center gap-1 rounded-md border border-white/[0.08] px-1.5 text-[11px] font-medium text-neutral-600 transition-colors hover:border-white/[0.14] hover:text-neutral-300 peer-checked:border-white/[0.16] peer-checked:bg-white/[0.08] peer-checked:text-neutral-200 peer-focus-visible:ring-2 peer-focus-visible:ring-white/20 [&_svg]:opacity-0 peer-checked:[&_svg]:opacity-100">
                <Check className="h-3 w-3" />
                branch
              </span>
            </label>
            <UiButton
              size="xs"
              className="h-6 w-6 shrink-0 rounded-md border border-white/10 bg-neutral-100 px-0 text-black shadow-none hover:bg-white disabled:bg-white/10 disabled:text-white/30"
              aria-label="Create parallel workspace"
              disabled={busy || (createBranch && !branchName.trim()) || (!createBranch && !branchName.trim() && !baseRef.trim())}
              onClick={() => createWorkspace.mutate()}
            >
              <Plus className="h-3.5 w-3.5" />
            </UiButton>
          </div>
          <button
            type="button"
            className="mt-1.5 h-5 rounded px-1 text-left text-[11px] text-neutral-600 transition-colors hover:bg-white/[0.04] hover:text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:opacity-40"
            disabled={busy}
            onClick={confirmPrune}
          >
            Prune stale
          </button>
        </div>

        {failure && <div className="border-t border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">{errorMessage(failure)}</div>}
      </PopoverContent>
    </Popover>
  );
}

function WorkspaceRow({
  workspace,
  busy,
  canRemoveWorkspace,
  onSwitch,
  onOpenWindow,
  onOpenEditor,
  onOpenTerminal,
  onRemove
}: {
  workspace: RepoWorkspace;
  busy: boolean;
  canRemoveWorkspace: boolean;
  onSwitch: () => void;
  onOpenWindow: () => void;
  onOpenEditor: () => void;
  onOpenTerminal: () => void;
  onRemove: () => void;
}) {
  const canSwitch = !workspace.isActive && !workspace.missing && !workspace.prunable && !workspace.bare;
  const canOpen = !workspace.missing && !workspace.prunable && !workspace.bare;
  const copy = workspaceProductCopy(workspace);
  const badges = workspaceBadges(workspace, copy);
  return (
    <div
      className={cn(
        "group flex items-start gap-2 rounded-md px-2 py-2 transition-colors",
        workspace.isActive ? "bg-white/[0.04]" : "hover:bg-white/[0.035]"
      )}
    >
      <button
        type="button"
        className={cn(
          "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-default",
          workspace.isActive ? "bg-emerald-400/10 text-emerald-400" : "text-neutral-600 enabled:hover:text-neutral-300 disabled:opacity-45"
        )}
        disabled={!canSwitch || busy}
        onClick={onSwitch}
        title={workspace.isActive ? "Current workspace" : "Switch workspace"}
        aria-label={
          workspace.isActive ? `${basename(workspace.localPath)} is the current workspace` : `Switch to ${basename(workspace.localPath)}`
        }
      >
        {workspace.isActive ? <Check className="h-3.5 w-3.5" /> : <GitBranch className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium leading-5 text-neutral-100">{basename(workspace.localPath)}</span>
          {badges.map((badge) => (
            <WorkspaceBadge key={badge.label} tone={badge.tone}>
              {badge.label}
            </WorkspaceBadge>
          ))}
          {workspace.isDirty && <WorkspaceBadge tone="warning">dirty</WorkspaceBadge>}
          {workspace.locked && <WorkspaceBadge>locked</WorkspaceBadge>}
          {workspace.prunable && <WorkspaceBadge tone="danger">prunable</WorkspaceBadge>}
          {workspace.detached && <WorkspaceBadge>detached</WorkspaceBadge>}
        </div>
        <div className="flex min-w-0 items-center gap-2 text-[11px] leading-4 text-neutral-600" title={workspace.localPath}>
          <span className="max-w-[11rem] truncate font-mono text-neutral-400">{workspace.branch ?? "detached"}</span>
          <span className="font-mono tabular-nums">{shortSha(workspace.headSha)}</span>
          <span className="shrink-0" title={formatDate(workspace.lastSeenAt)}>
            seen {formatRelative(workspace.lastSeenAt)}
          </span>
        </div>
        {workspace.kind === "worktree" && (
          <div className="truncate text-[11px] leading-4 text-neutral-700" title={copy.cleanupDetail}>
            {copy.cleanupDetail}
          </div>
        )}
      </div>
      <button
        type="button"
        className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-600 opacity-0 transition enabled:hover:bg-white/[0.05] enabled:hover:text-neutral-200 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:opacity-25"
        title="Open workspace in editor"
        aria-label={`Open ${basename(workspace.localPath)} workspace in editor`}
        disabled={!canOpen}
        onClick={onOpenEditor}
      >
        <Code2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-600 opacity-0 transition enabled:hover:bg-white/[0.05] enabled:hover:text-neutral-200 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:opacity-25"
        title="Open terminal in workspace"
        aria-label={`Open terminal in ${basename(workspace.localPath)} workspace`}
        disabled={!canOpen}
        onClick={onOpenTerminal}
      >
        <Terminal className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-600 opacity-0 transition enabled:hover:bg-white/[0.05] enabled:hover:text-neutral-200 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:opacity-25"
        title="Open workspace in new window"
        aria-label={`Open ${basename(workspace.localPath)} in new window`}
        disabled={!canOpen}
        onClick={onOpenWindow}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {workspace.kind === "worktree" && (
        <button
          type="button"
          className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-600 opacity-0 transition group-hover:opacity-100 enabled:hover:bg-red-500/10 enabled:hover:text-red-300 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/20 disabled:opacity-25"
          title={canRemoveWorkspace ? "Remove parallel workspace" : "Switch to another workspace before removing"}
          aria-label={`Remove ${basename(workspace.localPath)} parallel workspace`}
          disabled={!canRemoveWorkspace || busy}
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function WorkspaceBadge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warning" | "danger" | "good" }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase leading-none",
        tone === "neutral" && "border-white/[0.08] bg-transparent text-neutral-500",
        tone === "warning" && "border-amber-400/15 bg-transparent text-amber-300",
        tone === "danger" && "border-red-400/15 bg-transparent text-red-300",
        tone === "good" && "border-emerald-400/15 bg-transparent text-emerald-300"
      )}
    >
      {children}
    </span>
  );
}

function workspaceBadges(
  workspace: RepoWorkspace,
  copy: ReturnType<typeof workspaceProductCopy>
): Array<{ label: string; tone?: "neutral" | "warning" | "danger" | "good" }> {
  if (workspace.kind === "clone") return [{ label: "Primary" }];
  const badges: Array<{ label: string; tone?: "neutral" | "warning" | "danger" | "good" }> = [{ label: "Parallel" }];
  if (copy.origin === "agent") badges.push({ label: "Agent" });
  if (copy.cleanupStatus !== "safe") badges.push({ label: copy.cleanupLabel, tone: cleanupToneFor(copy.cleanupStatus) });
  return badges;
}

function cleanupToneFor(status: ReturnType<typeof workspaceProductCopy>["cleanupStatus"]): "neutral" | "warning" | "danger" | "good" {
  if (status === "safe") return "good";
  if (status === "missing") return "danger";
  if (status === "primary") return "neutral";
  return "warning";
}
