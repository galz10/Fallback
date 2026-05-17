import { defaultCommandPaletteKeybindings, type AppSettings } from "../../shared/domain/settings";

export const syncFrequencyOptions = [5, 15, 30, 60, 120, 240];
export const closedIssueRetentionOptions = [0, 90, 180, 365, 730, 1095];

export const fallbackSettings: AppSettings = {
  workspacePath: "Not loaded",
  defaultWatchMode: "cloned",
  cloneReposByDefault: true,
  createRepoFoldersOnWatch: true,
  openRepoFolderAfterWatch: false,
  restoreWindowsOnLaunch: false,
  syncFrequencyMinutes: 30,
  closedIssueRetentionDays: 365,
  shell: {
    preferredEditorCommand: null,
    preferredTerminalCommand: null
  },
  branchIntegrity: {
    enabled: true,
    fetchSafetyRefs: true,
    automaticAuditAfterSync: true,
    alertThreshold: "high",
    largeDiffRatioThreshold: 5,
    largeDiffAbsoluteThreshold: 500,
    requireExactMergeGroupTreeForReleases: true
  },
  attention: {
    collapseBotActivity: true,
    promoteFailingChecks: true,
    promoteDirectMentions: true,
    promoteReviewRequests: true,
    quietPassingCi: true,
    workingHoursStart: "09:00",
    workingHoursEnd: "17:00"
  },
  keybindings: {
    commandPalette: { ...defaultCommandPaletteKeybindings }
  },
  commitTemplates: []
};
