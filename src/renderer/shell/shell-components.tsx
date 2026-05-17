import React from "react";

type ShellComponent = React.ElementType;

export interface AppShellComponents {
  ActionsView: ShellComponent;
  AccountIdentityButton: ShellComponent;
  BranchIntegrityView: ShellComponent;
  BranchSelector: ShellComponent;
  WorkspaceSelector: ShellComponent;
  CredentialDiagnosticsDialog: ShellComponent;
  LocalChangesView: ShellComponent;
  RepoCodeView: ShellComponent;
  SettingsView: ShellComponent;
  StatusView: ShellComponent;
  CommandPalette: ShellComponent;
  HomeView: ShellComponent;
  NotificationInboxButton: ShellComponent;
  ProfileMenu: ShellComponent;
  Toaster: ShellComponent;
  IssueDetailView: ShellComponent;
  IssueListView: ShellComponent;
  MyWorkView: ShellComponent;
  PRDetailView: ShellComponent;
  PullRequestListView: ShellComponent;
}

export const ShellComponentsContext = React.createContext<AppShellComponents | null>(null);

export function useShellComponents(): AppShellComponents {
  const components = React.useContext(ShellComponentsContext);
  if (!components) throw new Error("AppShell components are not available");
  return components;
}
