import type { BranchIntegritySeverity } from "./branch-integrity.js";

export interface AppSettings {
  workspacePath: string;
  defaultWatchMode: "metadata-only" | "cloned";
  cloneReposByDefault: boolean;
  createRepoFoldersOnWatch: boolean;
  openRepoFolderAfterWatch: boolean;
  restoreWindowsOnLaunch: boolean;
  syncFrequencyMinutes: number;
  closedIssueRetentionDays: number;
  shell: ShellHandoffSettings;
  branchIntegrity: BranchIntegritySettings;
  attention: AttentionSettings;
  keybindings: KeybindingSettings;
  commitTemplates: FallbackCommitTemplate[];
}

export interface ShellHandoffSettings {
  preferredEditorCommand: string | null;
  preferredTerminalCommand: string | null;
}

export interface AttentionSettings {
  collapseBotActivity: boolean;
  promoteFailingChecks: boolean;
  promoteDirectMentions: boolean;
  promoteReviewRequests: boolean;
  quietPassingCi: boolean;
  workingHoursStart: string;
  workingHoursEnd: string;
}

export const commandPaletteKeybindingActionIds = [
  "home",
  "my-work",
  "open-notifications",
  "code",
  "local-changes",
  "pull-requests",
  "issues",
  "actions",
  "branch-integrity",
  "settings"
] as const;

export type CommandPaletteKeybindingActionId = (typeof commandPaletteKeybindingActionIds)[number];

export interface KeybindingSettings {
  commandPalette: Record<CommandPaletteKeybindingActionId, string | null>;
}

export const defaultCommandPaletteKeybindings: Record<CommandPaletteKeybindingActionId, string | null> = {
  home: "Ctrl+H",
  "my-work": "Ctrl+M",
  "open-notifications": "Ctrl+N",
  code: "Ctrl+C",
  "local-changes": "Ctrl+L",
  "pull-requests": "Ctrl+P",
  issues: "Ctrl+I",
  actions: "Ctrl+A",
  "branch-integrity": "Ctrl+B",
  settings: "Ctrl+,"
};

export interface BranchIntegritySettings {
  enabled: boolean;
  fetchSafetyRefs: boolean;
  automaticAuditAfterSync: boolean;
  alertThreshold: BranchIntegritySeverity;
  largeDiffRatioThreshold: number;
  largeDiffAbsoluteThreshold: number;
  requireExactMergeGroupTreeForReleases: boolean;
}

export interface FallbackCommitTemplate {
  id: string;
  name: string;
  body: string;
  repoId: string | null;
  createdAt: string;
  updatedAt: string;
}
