import React from "react";
import {
  AlertIcon as GitHubAlertIcon,
  CheckIcon as GitHubCheckIcon,
  CodeIcon as GitHubCodeIcon,
  CommentDiscussionIcon as GitHubCommentIcon,
  GearIcon as GitHubGearIcon,
  GitCommitIcon as GitHubCommitIcon,
  GitPullRequestIcon as GitHubPullRequestIcon,
  IssueOpenedIcon as GitHubIssueOpenedIcon,
  PlayIcon as GitHubPlayIcon,
  PulseIcon as GitHubPulseIcon,
  RepoIcon as GitHubRepoIcon,
  WorkflowIcon as GitHubWorkflowIcon
} from "@primer/octicons-react";
import {
  Archive,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  GitFork,
  Home,
  Plus,
  RefreshCcw,
  RotateCcw,
  ShieldAlert,
  Settings,
  Terminal,
  Upload,
  Wrench,
  X
} from "lucide-react";
import { toast } from "sonner";
import type { CommandPaletteKeybindingActionId, KeybindingSettings } from "../../../shared/domain/settings";
import type { FallbackWindowContext } from "../../../shared/domain/window-context";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type { LocalChangesSummary } from "../../../shared/domain/local-git";
import { branchIntegrityAutomaticAuditLimit } from "../../../shared/branch-integrity-config";
import type { AttentionLane } from "../../../shared/attention";
import { branchSafetyReport } from "../../../shared/product-coherence";
import type { AppView } from "../../state/navigation-store";
import { compactCount } from "../../lib/format";
import type { CommandPaletteGroup, CommandPaletteItem, CommandPaletteViewId } from "./CommandPalette.types";

export type CommandPaletteCatalogView = { id: CommandPaletteViewId; title: string };

export type CommandPaletteRunAsync = (label: string, task: () => Promise<unknown>, repoId?: string | null) => Promise<void>;

export interface CommandPaletteActionCatalogInput {
  repos: WatchedRepo[];
  selectedRepo: WatchedRepo | null;
  activeView: AppView;
  keybindings: KeybindingSettings["commandPalette"];
  windowContexts: FallbackWindowContext[];
  localChangesSummaries: LocalChangesSummary[];
  closeAndSetView: (view: AppView, repoId?: string | null) => void;
  setMyWorkLane: (lane: AttentionLane) => void;
  pushView: (view: CommandPaletteCatalogView) => void;
  runAsync: CommandPaletteRunAsync;
}

export interface CurrentRepoActionCatalogInput {
  repo: WatchedRepo;
  summary: LocalChangesSummary | null;
  closeAndSetView: (view: AppView, repoId?: string | null) => void;
  pushView: (view: CommandPaletteCatalogView) => void;
  runAsync: CommandPaletteRunAsync;
}

export interface CommandActionDefinition {
  id: string;
  title: string;
  description: string;
  searchTerms?: string[];
  shortcut?: string[];
  disabled?: string;
  keepOpen?: boolean;
  leadingContent?: React.ReactNode;
  trailingContent?: React.ReactNode;
  run: () => void | Promise<void>;
}

export interface CommandSubmenuDefinition {
  id: CommandPaletteViewId | string;
  title: string;
  description: string;
  disabled?: string;
  leadingContent?: React.ReactNode;
  run: () => void;
}

export function commandActionItem(definition: CommandActionDefinition): CommandPaletteItem {
  return {
    kind: "action",
    value: `action:${definition.id}`,
    title: definition.title,
    description: definition.description,
    searchTerms: definition.searchTerms ?? [definition.id, definition.title, definition.description],
    shortcut: definition.shortcut ?? [],
    disabled: definition.disabled,
    keepOpen: definition.keepOpen ?? false,
    leadingContent: definition.leadingContent,
    trailingContent: definition.trailingContent,
    run: definition.run
  };
}

export function commandSubmenuItem(definition: CommandSubmenuDefinition): CommandPaletteItem {
  return {
    kind: "submenu",
    value: `submenu:${definition.id}`,
    title: definition.title,
    description: definition.description,
    searchTerms: [definition.id, definition.title, definition.description],
    disabled: definition.disabled,
    keepOpen: true,
    leadingContent: definition.leadingContent,
    run: definition.run
  };
}

export function buildCoreActionCatalog({
  repos,
  selectedRepo,
  activeView,
  keybindings,
  windowContexts,
  localChangesSummaries,
  closeAndSetView,
  setMyWorkLane,
  pushView,
  runAsync
}: CommandPaletteActionCatalogInput): CommandPaletteItem[] {
  const shortcutFor = (id: CommandPaletteKeybindingActionId) => keybindingShortcut(keybindings[id]);
  return [
    actionItem("home", "Go to Home", "Watched repositories and repo groups", icon(Home), shortcutFor("home"), () =>
      closeAndSetView("home")
    ),
    actionItem(
      "open-current-window",
      "Open current view in new window",
      selectedRepo ? `${selectedRepo.fullName} / ${activeView}` : activeView,
      icon(ExternalLink),
      [],
      async () => {
        await window.fallback.window.openContext({
          repoId: selectedRepo?.id ?? null,
          view: activeView
        });
      },
      undefined,
      true
    ),
    ...windowContexts
      .slice(0, 3)
      .map((context) =>
        actionItem(
          `switch-window-context-${context.id}`,
          "Switch to window context",
          context.navigationStack.at(-1)?.label ?? context.view,
          icon(Copy),
          [],
          () => closeAndSetView(context.view as AppView, context.repoId)
        )
      ),
    actionItem(
      "my-work",
      "Go to My Work",
      "Actionable pull requests and issues that need you",
      icon(GitHubIssueOpenedIcon),
      shortcutFor("my-work"),
      () => closeAndSetView("My Work")
    ),
    actionItem(
      "open-notifications",
      "Open notifications",
      "Top-right inbox for recent GitHub updates",
      icon(GitHubCommentIcon),
      shortcutFor("open-notifications"),
      () => {
        window.dispatchEvent(new Event("fallback:toggle-notifications"));
      }
    ),
    actionItem(
      "code",
      "Go to Code",
      selectedRepo ? selectedRepo.fullName : "Select a repo first",
      icon(GitHubCodeIcon),
      shortcutFor("code"),
      () => {
        if (selectedRepo) closeAndSetView("Code", selectedRepo.id);
      },
      selectedRepo ? undefined : "No selected repo"
    ),
    actionItem(
      "local-changes",
      "View Local Changes",
      selectedRepo ? selectedRepo.fullName : "Select a repo first",
      icon(RotateCcw),
      shortcutFor("local-changes"),
      () => {
        if (selectedRepo) closeAndSetView("Local Changes", selectedRepo.id);
      },
      selectedRepo?.localPath ? undefined : "No local folder"
    ),
    actionItem(
      "local-changes-new-window",
      "Open Local Changes in new window",
      selectedRepo ? selectedRepo.fullName : "Select a repo first",
      icon(ExternalLink),
      [],
      async () => {
        if (selectedRepo) await window.fallback.window.openContext({ repoId: selectedRepo.id, view: "Local Changes" });
      },
      selectedRepo?.localPath ? undefined : "No local folder",
      true
    ),
    actionItem(
      "pull-requests",
      "View Pull Requests",
      selectedRepo ? `Review pull requests in ${selectedRepo.fullName}` : "Select a repo first",
      icon(GitHubPullRequestIcon),
      shortcutFor("pull-requests"),
      () => {
        if (selectedRepo) closeAndSetView("Pull requests", selectedRepo.id);
      },
      selectedRepo ? undefined : "No selected repo"
    ),
    actionItem(
      "issues",
      "View Issues",
      selectedRepo ? selectedRepo.fullName : "Select a repo first",
      icon(GitHubIssueOpenedIcon),
      shortcutFor("issues"),
      () => {
        if (selectedRepo) closeAndSetView("Issues", selectedRepo.id);
      },
      selectedRepo ? undefined : "No selected repo"
    ),
    actionItem(
      "actions",
      "View Actions",
      selectedRepo ? selectedRepo.fullName : "Select a repo first",
      icon(GitHubWorkflowIcon),
      shortcutFor("actions"),
      () => {
        if (selectedRepo) closeAndSetView("Actions", selectedRepo.id);
      },
      selectedRepo ? undefined : "No selected repo"
    ),
    actionItem(
      "branch-integrity",
      "Open Branch Watch",
      selectedRepo ? selectedRepo.fullName : "Select a repo first",
      icon(ShieldAlert),
      shortcutFor("branch-integrity"),
      () => {
        if (selectedRepo) closeAndSetView("Branch Integrity", selectedRepo.id);
      },
      selectedRepo ? undefined : "No selected repo"
    ),
    submenuItem("add-repo", "Add watched repository...", "Paste or search owner/name", icon(Plus), () =>
      pushView({ id: "add-repo", title: "Add watched repository" })
    ),
    submenuItem("open", "Open...", "Folder, GitHub repo, PRs, or issues", icon(FolderOpen), () => pushView({ id: "open", title: "Open" })),
    submenuItem("sync", "Sync...", "Selected repo, all repos, My Work, diagnostics", icon(RefreshCcw), () =>
      pushView({ id: "sync", title: "Sync" })
    ),
    submenuItem(
      "local-actions",
      "Local changes...",
      "Stage, unstage, stash, or open local changes",
      icon(Archive),
      () => pushView({ id: "local-changes", title: "Local changes" }),
      selectedRepo?.localPath ? undefined : "No local folder"
    ),
    actionItem("settings", "Open Settings", "Accounts, cache, and local preferences", icon(Settings), shortcutFor("settings"), () =>
      closeAndSetView("Settings")
    ),
    actionItem("github-status", "Open GitHub Status", "Health checks and offline status", icon(GitHubPulseIcon), [], () =>
      closeAndSetView("Status")
    ),
    actionItem(
      "operation-recovery",
      "Open Operation Recovery",
      "Recovery commands, diagnostics, and recent operation history",
      icon(RotateCcw),
      [],
      () => closeAndSetView("Status")
    ),
    actionItem(
      "sync-all",
      "Sync all watched repos",
      `${compactCount(repos.length)} watched`,
      icon(RefreshCcw),
      [],
      () => runAsync("Sync queued for watched repos.", () => window.fallback.repos.refreshAll()),
      repos.length ? undefined : "No watched repos"
    ),
    actionItem(
      "refresh-my-work",
      "Refresh My Work",
      "Refresh assigned pull requests, issues, and review work",
      icon(GitHubPlayIcon),
      [],
      () => runAsync("My Work refresh queued.", () => window.fallback.prs.refreshMine())
    ),
    actionItem("refresh-notifications", "Refresh notifications", "Refresh the attention inbox", icon(RefreshCcw), [], () =>
      runAsync("Notifications refresh queued.", () => window.fallback.notifications.refresh())
    ),
    actionItem(
      "mark-notifications-read",
      "Mark all notifications read",
      "Keep My Work responsibility state intact",
      icon(GitHubCheckIcon),
      [],
      () => runAsync("Notifications marked read.", () => window.fallback.notifications.markAllRead())
    ),
    actionItem("show-needs-me", "Show Needs me", "Open the default My Work lane", icon(GitHubAlertIcon), [], () => {
      setMyWorkLane("needs_me");
      closeAndSetView("My Work");
    }),
    actionItem(
      "show-at-risk-work",
      "Show At risk",
      "Open risky checks, branch safety, and blocked sends",
      icon(GitHubAlertIcon),
      [],
      () => {
        setMyWorkLane("at_risk");
        closeAndSetView("My Work");
      }
    ),
    actionItem("show-snoozed-work", "Show Snoozed", "Open My Work and review snoozed items", icon(Clock), [], () => {
      setMyWorkLane("snoozed");
      closeAndSetView("My Work");
    }),
    actionItem(
      "export-diagnostics",
      "Export diagnostics",
      "Redacted diagnostics bundle",
      icon(Download),
      [],
      async () => {
        const exportResult = await window.fallback.cache.exportDiagnostics(false);
        toast.success(`Diagnostics exported to ${exportResult.path}`);
      },
      undefined,
      true
    ),
    ...localChangesSummaries
      .filter((summary) => summary.isDirty)
      .slice(0, 2)
      .map((summary) =>
        actionItem(`dirty-${summary.repoId}`, "View dirty repo", localChangesSummaryLabel(summary), icon(RotateCcw), [], () =>
          closeAndSetView("Local Changes", summary.repoId)
        )
      )
  ];
}

export function buildCurrentRepoActionCatalog({
  repo,
  summary,
  closeAndSetView,
  pushView,
  runAsync
}: CurrentRepoActionCatalogInput): CommandPaletteItem[] {
  return [
    actionItem("repo-code", "Open selected repo", repo.fullName, icon(GitHubRepoIcon), ["↵"], () => closeAndSetView("Code", repo.id)),
    actionItem(
      "repo-open-new-window",
      "Open selected repo in new window",
      repo.fullName,
      icon(ExternalLink),
      [],
      async () => {
        await window.fallback.window.openContext({ repoId: repo.id, view: "Code" });
      },
      undefined,
      true
    ),
    actionItem(
      "repo-graph-new-window",
      "Open commit graph in new window",
      repo.fullName,
      icon(GitHubCommitIcon),
      [],
      async () => {
        await window.fallback.window.openContext({ repoId: repo.id, view: "Code", selectedEntityId: "code:Commits" });
      },
      undefined,
      true
    ),
    actionItem("repo-sync", "Sync selected repo", repo.syncProgressMessage ?? syncStatusLabel(repo.syncStatus), icon(RefreshCcw), [], () =>
      runAsync(`Sync queued for ${repo.fullName}.`, () => window.fallback.repos.refresh(repo.id), repo.id)
    ),
    localGitOperationAction(
      repo,
      "repo-git-fetch",
      "Fetch",
      "Fetch remote refs for the active workspace",
      icon(Download),
      "Fetch completed.",
      () => window.fallback.repos.fetchWorkspace(repo.id)
    ),
    localGitOperationAction(
      repo,
      "repo-git-pull",
      "Pull current branch",
      "Pull from upstream with --ff-only",
      icon(RefreshCcw),
      "Pull completed.",
      () => window.fallback.repos.pullWorkspace(repo.id, { strategy: "ff-only" })
    ),
    localGitOperationAction(repo, "repo-git-push", "Push current branch", "Push commits to upstream", icon(Upload), "Push completed.", () =>
      window.fallback.repos.pushWorkspace(repo.id)
    ),
    localGitOperationAction(
      repo,
      "repo-git-publish",
      "Publish branch",
      "Push current branch and set upstream",
      icon(GitFork),
      "Branch published.",
      () => window.fallback.repos.publishWorkspace(repo.id)
    ),
    actionItem(
      "repo-conflict-open",
      "Open conflict panel",
      "Review conflict risk and active conflicted files",
      icon(ShieldAlert),
      [],
      () => closeAndSetView("Local Changes", repo.id),
      repo.localPath ? undefined : "No local folder"
    ),
    actionItem(
      "repo-conflict-open-first-file",
      "Open first conflicted file",
      "Open the first active conflicted path in your editor",
      icon(ExternalLink),
      [],
      async () => {
        const state = await window.fallback.repos.conflictState(repo.id);
        const firstFile = state.files[0];
        if (!state.isActive || !firstFile) {
          toast.info("No active conflicted files.");
          return;
        }
        await runAsync("Opened first conflicted file.", () => window.fallback.repos.openConflictFile(repo.id, firstFile.path), repo.id);
      },
      repo.localPath ? undefined : "No local folder",
      true
    ),
    actionItem(
      "repo-conflict-open-merge-tool",
      "Open merge tool for conflict",
      "Launch the configured Git merge tool for the first conflicted path",
      icon(Wrench),
      [],
      async () => {
        const state = await window.fallback.repos.conflictState(repo.id);
        const firstFile = state.files[0];
        if (!state.isActive || !firstFile) {
          toast.info("No active conflicted files.");
          return;
        }
        await runAsync("Opened merge tool.", () => window.fallback.repos.openMergeTool(repo.id, firstFile.path), repo.id);
      },
      repo.localPath ? undefined : "No local folder",
      true
    ),
    actionItem(
      "repo-conflict-abort",
      "Abort active conflict operation",
      "Abort merge, rebase, cherry-pick, or revert",
      icon(X),
      [],
      async () => {
        if (!window.confirm("Abort the active Git operation?")) return;
        await runAsync("Active Git operation aborted.", () => window.fallback.repos.abortConflict(repo.id), repo.id);
      },
      repo.localPath ? undefined : "No local folder",
      true
    ),
    actionItem(
      "repo-conflict-copy-diagnostics",
      "Copy conflict diagnostics",
      "Copy active conflict state as text",
      icon(Copy),
      [],
      async () => {
        const state = await window.fallback.repos.conflictState(repo.id);
        await navigator.clipboard.writeText(JSON.stringify(state, null, 2));
        toast.success("Conflict diagnostics copied.");
      },
      repo.localPath ? undefined : "No local folder",
      true
    ),
    actionItem(
      "repo-local-changes",
      "View Local Changes",
      summary?.isDirty ? localChangesSummaryLabel(summary) : repo.fullName,
      icon(RotateCcw),
      [],
      () => closeAndSetView("Local Changes", repo.id),
      repo.localPath ? undefined : "No local folder",
      false,
      dirtyBadge(summary)
    ),
    actionItem(
      "repo-branch-integrity",
      "Show Branch Watch",
      "Suspicious branch changes, evidence, and recovery paths",
      icon(ShieldAlert),
      [],
      () => closeAndSetView("Branch Integrity", repo.id)
    ),
    actionItem(
      "repo-run-integrity-audit",
      "Run Branch Watch Full Audit",
      "Deeply verify first-parent history against cached PR evidence",
      icon(ShieldAlert),
      [],
      () =>
        runAsync(
          "Branch Watch audit completed.",
          () => window.fallback.branchIntegrity.auditRepo(repo.id, { mode: "full", limit: branchIntegrityAutomaticAuditLimit }),
          repo.id
        ),
      repo.localPath ? undefined : "No local folder",
      true
    ),
    actionItem(
      "repo-fetch-safety-refs",
      "Fetch Fallback Safety Refs",
      "Fetch refs/fallback merge-group and checkpoint refs",
      icon(Download),
      [],
      () => runAsync("Fallback safety refs fetched.", () => window.fallback.branchIntegrity.fetchSafetyRefs(repo.id), repo.id),
      repo.localPath ? undefined : "No local folder",
      true
    ),
    actionItem(
      "repo-refresh-workspaces",
      "Refresh Workspaces",
      "Detect primary and parallel workspaces for this repo",
      icon(GitFork),
      [],
      () => runAsync("Workspaces refreshed.", () => window.fallback.repos.refreshWorkspaces(repo.id), repo.id),
      repo.localPath ? undefined : "No local folder",
      true
    ),
    actionItem(
      "repo-prune-workspaces",
      "Prune Stale Workspaces",
      "Remove prunable Git workspace metadata",
      icon(GitFork),
      [],
      () => runAsync("Stale workspaces pruned.", () => window.fallback.repos.pruneWorkspaces(repo.id), repo.id),
      repo.localPath ? undefined : "No local folder",
      true
    ),
    actionItem(
      "repo-copy-integrity-report",
      "Copy Branch Watch Report",
      "Copy current findings with plain-language recovery context",
      icon(Copy),
      [],
      async () => {
        const findings = await window.fallback.branchIntegrity.latestFindings(repo.id);
        await navigator.clipboard.writeText(`${repo.fullName}\n\n${branchSafetyReport(findings)}`);
        toast.success("Branch Watch report copied.");
      },
      undefined,
      true
    ),
    actionItem(
      "repo-create-recovery-branch",
      "Create Recovery Branch",
      "Prepare a recovery branch from the latest open finding",
      icon(ShieldAlert),
      [],
      async () => {
        const findings = (await window.fallback.branchIntegrity.latestFindings(repo.id)).filter((finding) => finding.status === "open");
        if (!findings[0]) throw new Error("No open branch integrity findings.");
        await runAsync(
          "Recovery branch prepared.",
          () => window.fallback.branchIntegrity.createRecoveryBranch(repo.id, [findings[0]!.id]),
          repo.id
        );
      },
      repo.localPath ? undefined : "No local folder",
      true
    ),
    localShellAction(repo, "repo-open-folder", "Open local folder", icon(FolderOpen), () =>
      repo.localPath ? window.fallback.shell.openPath(repo.localPath) : undefined
    ),
    localShellAction(repo, "repo-open-editor", "Open in editor", icon(GitHubCodeIcon), () =>
      repo.localPath ? window.fallback.shell.openEditor(repo.localPath) : undefined
    ),
    localShellAction(repo, "repo-open-terminal", "Open in terminal", icon(Terminal), () =>
      repo.localPath ? window.fallback.shell.openTerminal(repo.localPath) : undefined
    ),
    localShellAction(repo, "repo-reveal-folder", "Reveal local folder", icon(FolderOpen), () =>
      repo.localPath ? window.fallback.shell.revealPath(repo.localPath) : undefined
    ),
    actionItem(
      "repo-open-github",
      "Open repo on GitHub",
      repo.htmlUrl ?? "No GitHub URL cached",
      icon(ExternalLink),
      [],
      () => {
        if (repo.htmlUrl) return window.fallback.shell.openExternal(repo.htmlUrl);
      },
      repo.htmlUrl ? undefined : "No GitHub URL"
    ),
    actionItem("repo-credentials", "Check credentials", repo.fullName, icon(GitHubCheckIcon), [], () =>
      runAsync("Credential diagnostics completed.", () => window.fallback.repos.checkCredentials(repo.id), repo.id)
    ),
    actionItem(
      "repo-identity",
      "Open repo identity settings",
      "Review local Git identity, signing, and auth context",
      icon(GitHubGearIcon),
      [],
      () => closeAndSetView("Settings", repo.id)
    ),
    submenuItem("repo-open-submenu", "Open...", "Folder, GitHub, PRs, or issues", icon(FolderOpen), () =>
      pushView({ id: "open", title: "Open" })
    )
  ];

  function localGitOperationAction(
    targetRepo: WatchedRepo,
    id: string,
    title: string,
    description: string,
    leadingContent: React.ReactNode,
    successLabel: string,
    task: () => Promise<unknown>
  ): CommandPaletteItem {
    return actionItem(
      id,
      title,
      description,
      leadingContent,
      [],
      () => runAsync(successLabel, task, targetRepo.id),
      targetRepo.localPath ? undefined : "No local folder",
      true
    );
  }
}

export function buildSyncSubmenuCatalog(repo: WatchedRepo | null, runAsync: CommandPaletteRunAsync): CommandPaletteGroup {
  return {
    value: "sync",
    label: "Sync",
    items: [
      actionItem(
        "sync-selected",
        "Sync selected repo",
        repo?.fullName ?? "Select a repo first",
        icon(RefreshCcw),
        [],
        () => {
          if (repo) return runAsync(`Sync queued for ${repo.fullName}.`, () => window.fallback.repos.refresh(repo.id), repo.id);
        },
        repo ? undefined : "No selected repo",
        true
      ),
      actionItem(
        "sync-fetch-workspace",
        "Fetch",
        repo?.fullName ?? "Select a repo first",
        icon(Download),
        [],
        () => {
          if (repo) return runAsync("Fetch completed.", () => window.fallback.repos.fetchWorkspace(repo.id), repo.id);
        },
        repo?.localPath ? undefined : "No local folder",
        true
      ),
      actionItem(
        "sync-pull-workspace",
        "Pull current branch",
        "Pull from upstream with --ff-only",
        icon(RefreshCcw),
        [],
        () => {
          if (repo)
            return runAsync("Pull completed.", () => window.fallback.repos.pullWorkspace(repo.id, { strategy: "ff-only" }), repo.id);
        },
        repo?.localPath ? undefined : "No local folder",
        true
      ),
      actionItem(
        "sync-push-workspace",
        "Push current branch",
        "Push commits to upstream",
        icon(Upload),
        [],
        () => {
          if (repo) return runAsync("Push completed.", () => window.fallback.repos.pushWorkspace(repo.id), repo.id);
        },
        repo?.localPath ? undefined : "No local folder",
        true
      ),
      actionItem(
        "sync-publish-workspace",
        "Publish branch",
        "Push current branch and set upstream",
        icon(GitFork),
        [],
        () => {
          if (repo) return runAsync("Branch published.", () => window.fallback.repos.publishWorkspace(repo.id), repo.id);
        },
        repo?.localPath ? undefined : "No local folder",
        true
      ),
      actionItem(
        "sync-all",
        "Sync all watched repos",
        "Queue sync jobs for all watched repos",
        icon(RefreshCcw),
        [],
        () => runAsync("Sync queued for watched repos.", () => window.fallback.repos.refreshAll()),
        undefined,
        true
      ),
      actionItem(
        "sync-my-work",
        "Refresh My Work",
        "Pull requests, issues, and review work assigned to you",
        icon(GitHubPlayIcon),
        [],
        () => runAsync("My Work refresh queued.", () => window.fallback.prs.refreshMine()),
        undefined,
        true
      ),
      actionItem(
        "sync-credentials",
        "Run credential diagnostics",
        repo?.fullName ?? "Select a repo first",
        icon(GitHubCheckIcon),
        [],
        () => {
          if (repo) return runAsync("Credential diagnostics completed.", () => window.fallback.repos.checkCredentials(repo.id), repo.id);
        },
        repo ? undefined : "No selected repo",
        true
      )
    ]
  };
}

export function buildLocalChangesSubmenuCatalog(
  repo: WatchedRepo | null,
  currentRepoActions: CommandPaletteItem[],
  runAsync: CommandPaletteRunAsync
): CommandPaletteGroup {
  const openLocalChanges = currentRepoActions.find((item) => item.value === "action:repo-local-changes");
  return {
    value: "local-changes",
    label: repo?.fullName ?? "Local Changes",
    items: [
      ...(openLocalChanges ? [openLocalChanges] : []),
      actionItem(
        "stage-all",
        "Stage all local changes",
        repo?.fullName ?? "Select a repo first",
        icon(Plus),
        [],
        () => {
          if (repo) return runAsync("All local changes staged.", () => window.fallback.repos.stageAllLocalChanges(repo.id), repo.id);
        },
        repo?.localPath ? undefined : "No local folder",
        true
      ),
      actionItem(
        "unstage-all",
        "Unstage all local changes",
        repo?.fullName ?? "Select a repo first",
        icon(RotateCcw),
        [],
        () => {
          if (repo) return runAsync("All local changes unstaged.", () => window.fallback.repos.unstageAllLocalChanges(repo.id), repo.id);
        },
        repo?.localPath ? undefined : "No local folder",
        true
      ),
      actionItem(
        "stash-all",
        "Stash all local changes",
        repo?.fullName ?? "Select a repo first",
        icon(Archive),
        [],
        () => {
          if (repo)
            return runAsync("Local changes stashed.", () => window.fallback.repos.stashLocalChanges(repo.id, `WIP: ${repo.name}`), repo.id);
        },
        repo?.localPath ? undefined : "No local folder",
        true
      )
    ]
  };
}

export function localChangesSummaryLabel(summary: LocalChangesSummary): string {
  const fileLabel = `${compactCount(summary.fileCount)} ${summary.fileCount === 1 ? "file" : "files"}`;
  if (summary.additions === 0 && summary.deletions === 0) return fileLabel;
  return `${fileLabel}, +${compactCount(summary.additions)} -${compactCount(summary.deletions)}`;
}

function actionItem(
  id: string,
  title: string,
  description: string,
  leadingContent: React.ReactNode,
  shortcut: string[],
  run: () => void | Promise<void>,
  disabled?: string,
  keepOpen = false,
  trailingContent?: React.ReactNode
): CommandPaletteItem {
  return commandActionItem({ id, title, description, shortcut, leadingContent, trailingContent, disabled, keepOpen, run });
}

function submenuItem(
  id: CommandPaletteViewId | string,
  title: string,
  description: string,
  leadingContent: React.ReactNode,
  run: () => void,
  disabled?: string
): CommandPaletteItem {
  return commandSubmenuItem({ id, title, description, leadingContent, disabled, run });
}

function localShellAction(
  repo: WatchedRepo,
  id: string,
  title: string,
  leadingContent: React.ReactNode,
  run: () => void | Promise<void> | undefined
): CommandPaletteItem {
  return actionItem(
    id,
    title,
    repo.localPath ?? "Repository is metadata-only",
    leadingContent,
    [],
    run,
    repo.localPath ? undefined : "No local folder"
  );
}

function icon(Icon: React.ComponentType<{ className?: string }>): React.ReactNode {
  return React.createElement(Icon, { className: "h-4 w-4" });
}

function keybindingShortcut(binding: string | null | undefined): string[] {
  return binding ? binding.split(/\s+/).filter(Boolean) : [];
}

function dirtyBadge(summary: LocalChangesSummary | null | undefined): React.ReactNode {
  if (!summary?.isDirty) return null;
  if (summary.additions === 0 && summary.deletions === 0) {
    return React.createElement(
      "span",
      { className: "rounded border border-border px-1.5 py-0.5 font-mono text-[10px]" },
      `${compactCount(summary.fileCount)} files`
    );
  }
  return React.createElement(
    "span",
    { className: "rounded border border-border px-1.5 py-0.5 font-mono text-[10px]" },
    `+${compactCount(summary.additions)} -${compactCount(summary.deletions)}`
  );
}

function syncStatusLabel(status: WatchedRepo["syncStatus"]): string {
  if (status === "fresh") return "Synced";
  return status.replace("_", " ");
}
