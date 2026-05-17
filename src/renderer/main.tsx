import React, { Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { AppShell } from "./shell/AppShell";
import type { AppShellComponents } from "./shell/shell-components";
import { queryClient } from "./app/query-client";
import "./styles.css";

const rendererModuleLoadedAt = performance.now();

declare global {
  interface Window {
    __fallbackStartup?: {
      htmlScript?: number;
      moduleLoaded?: number;
      rootRenderCalled?: number;
    };
  }
}

window.__fallbackStartup = {
  ...window.__fallbackStartup,
  moduleLoaded: rendererModuleLoadedAt
};

export const RENDERER_ENTRY_IMPORTS = [
  "react",
  "@tanstack/react-query",
  "ui-shell",
  "shell-icons",
  "app-store",
  "sync-active-context",
  "auth-recovery",
  "dotm-circular-3"
];

const ActionsView = React.lazy(() => import("./features/actions/ActionsView").then((module) => ({ default: module.ActionsView })));
const AccountIdentityButton = React.lazy(() =>
  import("./components/AccountIdentityButton").then((module) => ({ default: module.AccountIdentityButton }))
);
const BranchIntegrityView = React.lazy(() =>
  import("./features/branch-integrity/BranchIntegrityView").then((module) => ({ default: module.BranchIntegrityView }))
);
const BranchSelector = React.lazy(() =>
  import("./features/repo-code/BranchSelector").then((module) => ({ default: module.BranchSelector }))
);
const WorkspaceSelector = React.lazy(() =>
  import("./features/repo-code/WorkspaceSelector").then((module) => ({ default: module.WorkspaceSelector }))
);
const CredentialDiagnosticsDialog = React.lazy(() =>
  import("./components/CredentialDiagnosticsDialog").then((module) => ({ default: module.CredentialDiagnosticsDialog }))
);
const LocalChangesView = React.lazy(() =>
  import("./features/local-changes/LocalChangesView").then((module) => ({ default: module.LocalChangesView }))
);
const RepoCodeView = React.lazy(() => import("./features/repo-code/RepoCodeView").then((module) => ({ default: module.RepoCodeView })));
const SettingsView = React.lazy(() => import("./features/settings/SettingsView").then((module) => ({ default: module.SettingsView })));
const StatusView = React.lazy(() => import("./features/status/StatusView").then((module) => ({ default: module.StatusView })));
const CommandPalette = React.lazy(() =>
  import("./features/command-palette/CommandPalette").then((module) => ({ default: module.CommandPalette }))
);
const HomeView = React.lazy(() => import("./features/home/HomeView").then((module) => ({ default: module.HomeView })));
const NotificationInboxButton = React.lazy(() =>
  import("./components/NotificationInboxButton").then((module) => ({ default: module.NotificationInboxButton }))
);
const ProfileMenu = React.lazy(() => import("./components/ProfileMenu").then((module) => ({ default: module.ProfileMenu })));
const Toaster = React.lazy(() => import("./components/ui/sonner").then((module) => ({ default: module.Toaster })));
const githubWorkViews = () => import("./features/github-work/GitHubWorkViews");
const IssueDetailView = React.lazy(() => githubWorkViews().then((module) => ({ default: module.IssueDetailView })));
const IssueListView = React.lazy(() => githubWorkViews().then((module) => ({ default: module.IssueListView })));
const MyWorkView = React.lazy(() => githubWorkViews().then((module) => ({ default: module.MyWorkView })));
const PRDetailView = React.lazy(() => githubWorkViews().then((module) => ({ default: module.PRDetailView })));
const PullRequestListView = React.lazy(() => githubWorkViews().then((module) => ({ default: module.PullRequestListView })));

const shellComponents: AppShellComponents = {
  ActionsView,
  AccountIdentityButton,
  BranchIntegrityView,
  BranchSelector,
  WorkspaceSelector,
  CredentialDiagnosticsDialog,
  LocalChangesView,
  RepoCodeView,
  SettingsView,
  StatusView,
  CommandPalette,
  HomeView,
  NotificationInboxButton,
  ProfileMenu,
  Toaster,
  IssueDetailView,
  IssueListView,
  MyWorkView,
  PRDetailView,
  PullRequestListView
};

window.__fallbackStartup = {
  ...window.__fallbackStartup,
  rootRenderCalled: performance.now()
};

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <AppShell components={shellComponents} onRendererReady={() => window.fallback.performance.rendererReady(rendererReadyMetrics())} />
      </Suspense>
    </QueryClientProvider>
  </React.StrictMode>
);

function rendererReadyMetrics() {
  const fallbackStartup = window.__fallbackStartup;
  const navigationEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const shellPaintMs = performance.now();
  const rendererReadySentMs = performance.now();
  return {
    htmlScriptMs: fallbackStartup?.htmlScript,
    moduleLoadedMs: fallbackStartup?.moduleLoaded,
    rootRenderCalledMs: fallbackStartup?.rootRenderCalled,
    shellPaintMs,
    rendererReadySentMs,
    rendererReadyEpochMs: performance.timeOrigin + rendererReadySentMs,
    readyEffectMs: shellPaintMs,
    domInteractiveMs: navigationEntry?.domInteractive,
    domContentLoadedMs: navigationEntry?.domContentLoadedEventEnd,
    loadEventEndMs: navigationEntry?.loadEventEnd,
    entryImports: RENDERER_ENTRY_IMPORTS
  };
}
