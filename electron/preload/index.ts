import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppSettings } from "../../src/shared/domain/settings.js";
import type { WatchRepoInput } from "../../src/shared/domain/watched-repo.js";
import type { AppEventPayload, FallbackApi, RendererReadyMetrics } from "../../src/shared/contracts/fallback-api.js";
import { ipcChannelMetadata, type IpcEventChannelKey, type IpcInvokeChannelKey, type IpcSendChannelKey } from "../../src/shared/ipc.js";

function channel<Key extends keyof typeof ipcChannelMetadata>(key: Key): (typeof ipcChannelMetadata)[Key]["channel"] {
  return ipcChannelMetadata[key].channel;
}

// The typed FallbackApi interface constrains each call site; Electron's invoke boundary itself is dynamically typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function invoke<Key extends IpcInvokeChannelKey>(key: Key, ...args: unknown[]): Promise<any> {
  return ipcRenderer.invoke(channel(key), ...args);
}

function send<Key extends IpcSendChannelKey>(key: Key, ...args: unknown[]): void {
  ipcRenderer.send(channel(key), ...args);
}

function onAppEvent(key: IpcEventChannelKey, callback: (payload: AppEventPayload) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: AppEventPayload = {}) => callback(payload);
  const eventChannel = channel(key);
  ipcRenderer.on(eventChannel, listener);
  return () => ipcRenderer.removeListener(eventChannel, listener);
}

const api: FallbackApi = {
  startup: {
    snapshot: () => invoke("startupSnapshot")
  },
  performance: {
    rendererReady: (metrics?: RendererReadyMetrics) => send("performanceRendererReady", metrics)
  },
  events: {
    onReposChanged: (callback) => onAppEvent("eventsReposChanged", callback),
    onProfileChanged: (callback) => onAppEvent("eventsProfileChanged", callback),
    onLocalChangesChanged: (callback) => onAppEvent("eventsLocalChangesChanged", callback),
    onOperationsChanged: (callback) => onAppEvent("eventsOperationsChanged", callback),
    onSyncChanged: (callback) => onAppEvent("eventsSyncChanged", callback),
    onNotificationsChanged: (callback) => onAppEvent("eventsNotificationsChanged", callback),
    onOfflineActionsChanged: (callback) => onAppEvent("eventsOfflineActionsChanged", callback),
    onBranchIntegrityChanged: (callback) => onAppEvent("eventsBranchIntegrityChanged", callback),
    onHealthChanged: (callback) => onAppEvent("eventsHealthChanged", callback),
    onAppUpdateChanged: (callback) => onAppEvent("eventsAppUpdateChanged", callback)
  },
  auth: {
    connectGitHub: (token?: string) => invoke("authConnectGitHub", token),
    startGitHubBrowserOAuth: () => invoke("authStartGitHubBrowserOAuth"),
    startAddGitHubProfileOAuth: () => invoke("authStartAddGitHubProfileOAuth"),
    cancelGitHubBrowserOAuth: () => invoke("authCancelGitHubBrowserOAuth"),
    onBrowserOAuthResult: (callback) => {
      const listener = (_event: IpcRendererEvent, result: Parameters<typeof callback>[0]) => callback(result);
      ipcRenderer.on(channel("authBrowserOAuthResult"), listener);
      return () => ipcRenderer.removeListener(channel("authBrowserOAuthResult"), listener);
    },
    startGitHubOAuth: () => invoke("authStartGitHubOAuth"),
    completeGitHubOAuth: (deviceCode: string) => invoke("authCompleteGitHubOAuth", deviceCode),
    getAuthState: () => invoke("authGetState"),
    listAccounts: () => invoke("authListAccounts"),
    listProfiles: () => invoke("authListProfiles"),
    selectAccount: (accountId: string) => invoke("authSelectAccount", accountId),
    selectProfile: (profileId: string) => invoke("authSelectProfile", profileId),
    updateProfile: (profileId: string, input) => invoke("authUpdateProfile", profileId, input),
    renameProfile: (profileId: string, name: string) => invoke("authRenameProfile", profileId, name),
    updateProfileColor: (profileId: string, color: string | null) => invoke("authUpdateProfileColor", profileId, color),
    reconnectProfile: (profileId: string) => invoke("authReconnectProfile", profileId),
    deleteAccount: (accountId: string) => invoke("authDeleteAccount", accountId),
    removeProfile: (profileId: string) => invoke("authRemoveProfile", profileId),
    deleteAllAccounts: () => invoke("authDeleteAllAccounts"),
    disconnectGitHub: () => invoke("authDisconnectGitHub")
  },
  repos: {
    listAvailable: () => invoke("reposListAvailable"),
    listWatched: () => invoke("reposListWatched"),
    codeSummary: (repoId: string) => invoke("reposCodeSummary", repoId),
    listFiles: (repoId: string, path?: string) => invoke("reposListFiles", repoId, path),
    readFile: (repoId: string, path: string) => invoke("reposReadFile", repoId, path),
    listBranches: (repoId: string) => invoke("reposListBranches", repoId),
    switchBranch: (repoId: string, branch: string) => invoke("reposSwitchBranch", repoId, branch),
    getIdentity: (repoId: string, caller?: string) => invoke("reposGetIdentity", repoId, caller),
    updateIdentity: (repoId: string, input) => invoke("reposUpdateIdentity", repoId, input),
    applyLocalGitIdentity: (repoId: string) => invoke("reposApplyLocalGitIdentity", repoId),
    signingReadiness: (repoId: string) => invoke("reposSigningReadiness", repoId),
    verifySigning: (repoId: string) => invoke("reposVerifySigning", repoId),
    checkCredentials: (repoId: string) => invoke("reposCheckCredentials", repoId),
    commitTemplates: (repoId: string) => invoke("reposCommitTemplates", repoId),
    searchCommits: (repoId: string, input) => invoke("reposSearchCommits", repoId, input),
    cancelCommitSearch: (requestId: string) => invoke("reposCancelCommitSearch", requestId),
    commitGraph: (repoId: string, options) => invoke("reposCommitGraph", repoId, options),
    commitGraphPatch: (repoId: string, sha: string) => invoke("reposCommitGraphPatch", repoId, sha),
    listWorkspaces: (repoId: string) => invoke("reposListWorkspaces", repoId),
    refreshWorkspaces: (repoId: string) => invoke("reposRefreshWorkspaces", repoId),
    switchWorkspace: (repoId: string, workspaceId: string) => invoke("reposSwitchWorkspace", repoId, workspaceId),
    createWorkspace: (repoId: string, input) => invoke("reposCreateWorkspace", repoId, input),
    removeWorkspace: (repoId: string, workspaceId: string, input) => invoke("reposRemoveWorkspace", repoId, workspaceId, input),
    pruneWorkspaces: (repoId: string) => invoke("reposPruneWorkspaces", repoId),
    gitNetworkPreflight: (repoId: string) => invoke("reposGitNetworkPreflight", repoId),
    fetchWorkspace: (repoId: string) => invoke("reposFetchWorkspace", repoId),
    pullWorkspace: (repoId: string, input) => invoke("reposPullWorkspace", repoId, input),
    pushWorkspace: (repoId: string) => invoke("reposPushWorkspace", repoId),
    publishWorkspace: (repoId: string, input) => invoke("reposPublishWorkspace", repoId, input),
    conflictPreflight: (repoId: string, input) => invoke("reposConflictPreflight", repoId, input),
    conflictState: (repoId: string) => invoke("reposConflictState", repoId),
    abortConflict: (repoId: string, input) => invoke("reposAbortConflict", repoId, input),
    resolveConflictFile: (repoId: string, input) => invoke("reposResolveConflictFile", repoId, input),
    openConflictFile: (repoId: string, path: string) => invoke("reposOpenConflictFile", repoId, path),
    openMergeTool: (repoId: string, path: string) => invoke("reposOpenMergeTool", repoId, path),
    localChanges: (repoId: string) => invoke("reposLocalChanges", repoId),
    localChangesOverview: (repoId: string) => invoke("reposLocalChangesOverview", repoId),
    localChangePatch: (repoId: string, path: string) => invoke("reposLocalChangePatch", repoId, path),
    localChangesSummary: (repoIds?: string[], options?: { includeStats?: boolean }) => invoke("reposLocalChangesSummary", repoIds, options),
    applyLocalPatch: (repoId: string, input) => invoke("reposApplyLocalPatch", repoId, input),
    fileHistory: (repoId: string, path: string) => invoke("reposFileHistory", repoId, path),
    fileBlame: (repoId: string, path: string) => invoke("reposFileBlame", repoId, path),
    stageLocalFile: (repoId: string, path: string) => invoke("reposStageLocalFile", repoId, path),
    unstageLocalFile: (repoId: string, path: string) => invoke("reposUnstageLocalFile", repoId, path),
    stageAllLocalChanges: (repoId: string) => invoke("reposStageAllLocalChanges", repoId),
    unstageAllLocalChanges: (repoId: string) => invoke("reposUnstageAllLocalChanges", repoId),
    discardLocalFile: (repoId: string, path: string) => invoke("reposDiscardLocalFile", repoId, path),
    revertCommit: (repoId: string, sha: string) => invoke("reposRevertCommit", repoId, sha),
    commitLocalChanges: (repoId: string, input) => invoke("reposCommitLocalChanges", repoId, input),
    stashLocalChanges: (repoId: string, message?: string) => invoke("reposStashLocalChanges", repoId, message),
    stashLocalFiles: (repoId: string, paths: string[], message?: string) => invoke("reposStashLocalFiles", repoId, paths, message),
    stashDetail: (repoId: string, stashRef: string) => invoke("reposStashDetail", repoId, stashRef),
    applyStash: (repoId: string, stashRef: string) => invoke("reposApplyStash", repoId, stashRef),
    popStash: (repoId: string, stashRef: string) => invoke("reposPopStash", repoId, stashRef),
    dropStash: (repoId: string, stashRef: string) => invoke("reposDropStash", repoId, stashRef),
    listReleases: (repoId: string) => invoke("reposListReleases", repoId),
    listTags: (repoId: string) => invoke("reposListTags", repoId),
    listContributors: (repoId: string) => invoke("reposListContributors", repoId),
    watch: (input: WatchRepoInput) => invoke("reposWatch", input),
    unwatch: (repoId: string) => invoke("reposUnwatch", repoId),
    refresh: (repoId: string) => invoke("reposRefresh", repoId),
    refreshAll: () => invoke("reposRefreshAll")
  },
  repoGroups: {
    list: () => invoke("repoGroupsList"),
    create: (input) => invoke("repoGroupsCreate", input),
    update: (groupId: string, input) => invoke("repoGroupsUpdate", groupId, input),
    delete: (groupId: string) => invoke("repoGroupsDelete", groupId),
    setMemberships: (groupId: string, repoIds: string[]) => invoke("repoGroupsSetMemberships", groupId, repoIds)
  },
  prs: {
    list: (repoId: string, filters) => invoke("prsList", repoId, filters),
    listMine: () => invoke("prsListMine"),
    get: (repoId: string, number: number) => invoke("prsGet", repoId, number),
    getDiff: (repoId: string, number: number) => invoke("prsGetDiff", repoId, number),
    addComment: (repoId: string, number: number, body: string, options) => invoke("prsAddComment", repoId, number, body, options),
    submitReview: (repoId: string, number: number, input, options) => invoke("prsSubmitReview", repoId, number, input, options),
    getReviewDraft: (repoId: string, number: number) => invoke("prsGetReviewDraft", repoId, number),
    updateReviewDraft: (repoId: string, number: number, input) => invoke("prsUpdateReviewDraft", repoId, number, input),
    clearReviewDraft: (repoId: string, number: number, headSha?: string | null) => invoke("prsClearReviewDraft", repoId, number, headSha),
    refresh: (repoId: string, number: number) => invoke("prsRefresh", repoId, number),
    refreshMine: () => invoke("prsRefreshMine")
  },
  issues: {
    list: (repoId: string, filters) => invoke("issuesList", repoId, filters),
    listMine: () => invoke("issuesListMine"),
    get: (repoId: string, number: number) => invoke("issuesGet", repoId, number),
    addComment: (repoId: string, number: number, body: string, options) => invoke("issuesAddComment", repoId, number, body, options),
    refresh: (repoId: string, number: number) => invoke("issuesRefresh", repoId, number)
  },
  comments: {
    listRecent: (repoId: string) => invoke("commentsListRecent", repoId)
  },
  actions: {
    listChecks: (repoId: string) => invoke("actionsListChecks", repoId),
    listWorkflowRuns: (repoId: string) => invoke("actionsListWorkflowRuns", repoId)
  },
  notifications: {
    summary: () => invoke("notificationsSummary"),
    list: (input) => invoke("notificationsList", input),
    markRead: (ids: string[]) => invoke("notificationsMarkRead", ids),
    markAllRead: (input) => invoke("notificationsMarkAllRead", input),
    markDone: (id: string) => invoke("notificationsMarkDone", id),
    undoDone: (id: string) => invoke("notificationsUndoDone", id),
    snooze: (id: string, until: string) => invoke("notificationsSnooze", id, until),
    unsnooze: (id: string) => invoke("notificationsUnsnooze", id),
    mute: (id: string, until?: string | null) => invoke("notificationsMute", id, until),
    unmute: (id: string) => invoke("notificationsUnmute", id),
    refresh: () => invoke("notificationsRefresh")
  },
  offlineActions: {
    list: (input) => invoke("offlineActionsList", input),
    get: (id: string) => invoke("offlineActionsGet", id),
    summary: () => invoke("offlineActionsSummary"),
    update: (id: string, input) => invoke("offlineActionsUpdate", id, input),
    cancel: (id: string) => invoke("offlineActionsCancel", id),
    retry: (id: string) => invoke("offlineActionsRetry", id),
    flush: () => invoke("offlineActionsFlush"),
    onChanged: (callback) => onAppEvent("eventsOfflineActionsChanged", callback)
  },
  branchIntegrity: {
    auditRepo: (repoId: string, options) => invoke("branchIntegrityAuditRepo", repoId, options),
    auditAll: (options) => invoke("branchIntegrityAuditAll", options),
    latestFindings: (repoId?: string) => invoke("branchIntegrityLatestFindings", repoId),
    summary: (repoId: string) => invoke("branchIntegritySummary", repoId),
    summaryMany: (repoIds: string[]) => invoke("branchIntegritySummaryMany", repoIds),
    markResolved: (findingId: string) => invoke("branchIntegrityResolveFinding", findingId),
    recordSnapshot: (repoId: string, options) => invoke("branchIntegrityRecordSnapshot", repoId, options),
    fetchSafetyRefs: (repoId: string) => invoke("branchIntegrityFetchSafetyRefs", repoId),
    recoveryPlan: (repoId: string, findingIds: string[]) => invoke("branchIntegrityRecoveryPlan", repoId, findingIds),
    inspectDiff: (repoId: string, findingId: string, mode) => invoke("branchIntegrityInspectDiff", repoId, findingId, mode),
    createRecoveryBranch: (repoId: string, findingIds: string[], strategy) =>
      invoke("branchIntegrityCreateRecoveryBranch", repoId, findingIds, strategy),
    openRecoveryPullRequest: (repoId: string, findingIds: string[]) => invoke("branchIntegrityOpenRecoveryPr", repoId, findingIds)
  },
  sync: {
    setActiveContext: (context) => invoke("syncSetActiveContext", context)
  },
  operations: {
    listRecent: (repoId?: string) => invoke("operationsListRecent", repoId),
    cancel: (operationId: string) => invoke("operationsCancel", operationId)
  },
  search: {
    query: (q: string, filters) => invoke("searchQuery", q, filters)
  },
  health: {
    summary: () => invoke("healthSummary"),
    runProbe: (repoId?: string) => invoke("healthRunProbe", repoId),
    matrix: () => invoke("healthMatrix"),
    history: () => invoke("healthHistory"),
    offlineStatus: () => invoke("healthOfflineStatus")
  },
  appUpdate: {
    getState: () => invoke("appUpdateGetState"),
    check: () => invoke("appUpdateCheck"),
    download: () => invoke("appUpdateDownload"),
    install: () => invoke("appUpdateInstall")
  },
  settings: {
    get: () => invoke("settingsGet"),
    update: (patch: Partial<AppSettings>) => invoke("settingsUpdate", patch)
  },
  cache: {
    summary: () => invoke("cacheSummary"),
    summaryDetailed: () => invoke("cacheSummaryDetailed"),
    deleteRepo: (repoId: string) => invoke("cacheDeleteRepo", repoId),
    deleteAll: () => invoke("cacheDeleteAll"),
    exportDiagnostics: (includeSensitive?: boolean) => invoke("cacheExportDiagnostics", includeSensitive)
  },
  shell: {
    openExternal: (url: string) => invoke("shellOpenExternal", url),
    openPath: (path: string) => invoke("shellOpenPath", path),
    openEditor: (path: string) => invoke("shellOpenEditor", path),
    openEditorAtLine: (path: string, line?: number | null, workspacePath?: string | null) =>
      invoke("shellOpenEditorAtLine", path, line, workspacePath),
    openTerminal: (path: string) => invoke("shellOpenTerminal", path),
    revealPath: (path: string) => invoke("shellRevealPath", path)
  },
  window: {
    context: () => invoke("windowContext"),
    updateContext: (input) => invoke("windowUpdateContext", input),
    openContext: (input) => invoke("windowOpenContext", input),
    listContexts: () => invoke("windowListContexts"),
    close: () => invoke("windowClose"),
    minimize: () => invoke("windowMinimize"),
    toggleMaximize: () => invoke("windowToggleMaximize")
  }
};

contextBridge.exposeInMainWorld("fallback", api);
