import type {
  AuthState,
  GitHubAccountSession,
  GitHubBrowserOAuthFlow,
  GitHubBrowserOAuthResult,
  GitHubOAuthDeviceCompletion,
  GitHubOAuthDeviceFlow
} from "../domain/auth.js";
import type { AppSettings } from "../domain/settings.js";
import type { FallbackWindowContext, FallbackWindowContextInput } from "../domain/window-context.js";
import type {
  CreateRepoWorkspaceInput,
  GitHubRepoSummary,
  RemoveRepoWorkspaceInput,
  RepoWorkspace,
  WatchRepoInput,
  WatchedRepo
} from "../domain/watched-repo.js";
import type { RepoGroup, UpdateRepoGroupsInput } from "../domain/repo-group.js";
import type {
  CredentialDiagnosticReport,
  RepoIdentity,
  RepoSigningReadiness,
  RepoSigningVerification,
  UpdateRepoIdentityInput
} from "../domain/repo-identity.js";
import type {
  CommitSearchInput,
  CommitSearchResult,
  CommitGraphOptions,
  CommitGraphPatch,
  CommitGraphViewModel,
  RepoBranchSummary,
  RepoBranchSwitchResult,
  RepoCodeSummary,
  RepoContributorSummary,
  RepoFileContent,
  RepoFileEntry,
  RepoReleaseSummary,
  RepoTagSummary
} from "../domain/repo-code.js";
import type {
  CommitTemplate,
  LocalChangePatch,
  LocalFileBlame,
  LocalFileHistory,
  LocalChangesState,
  LocalChangesSummary,
  LocalCommitInput,
  LocalCommitResult,
  LocalGitConflictAbortInput,
  LocalGitConflictPreflight,
  LocalGitConflictPreflightInput,
  LocalGitConflictResolveInput,
  LocalGitConflictResolveResult,
  LocalGitConflictState,
  LocalGitNetworkPreflight,
  LocalGitNetworkResult,
  LocalGitPublishInput,
  LocalGitPullInput,
  LocalPatchApplyInput,
  LocalStashDetail
} from "../domain/local-git.js";
import type { OperationRecord } from "../domain/operation.js";
import type {
  OfflineAction,
  OfflineActionListInput,
  OfflineActionQueueSummary,
  UpdateOfflineActionInput,
  WritebackSubmitResult
} from "../domain/offline-action.js";
import type {
  ActionCheckSummary,
  IssueDetail,
  IssueListInput,
  IssueListResult,
  IssueSummary,
  PRFilters,
  PullRequestDetail,
  PullRequestDiff,
  PullRequestReviewDraft,
  PullRequestSummary,
  SearchFilters,
  SearchResult,
  SubmitPullRequestReviewInput,
  TimelineComment,
  UpdatePullRequestReviewDraftInput,
  WorkflowRunSummary
} from "../domain/github-work.js";
import type { SyncActiveContext, SyncJob } from "../domain/sync.js";
import type { GitHubHealthSummary, HealthHistory, HealthMatrixRow, HealthProbeResult, OfflineStatus } from "../domain/health.js";
import type { CacheSummary, DiagnosticsExport } from "../domain/cache.js";
import type {
  BranchIntegrityAuditOptions,
  BranchIntegrityAuditResult,
  BranchIntegrityAuditSummary,
  BranchIntegrityFinding,
  BranchIntegrityStatusSummary,
  BranchRecoveryPullRequest,
  BranchRecoveryPlan,
  BranchRecoveryResult,
  BranchSnapshot
} from "../domain/branch-integrity.js";
import type { AppUpdateActionResult, AppUpdateCheckResult, AppUpdateState } from "../domain/app-update.js";
import type { AttentionItem, AttentionListInput, AttentionSummary } from "../attention.js";

export interface FallbackApi {
  startup: StartupContract;
  auth: AuthContract;
  performance: PerformanceContract;
  events: EventsContract;
  repos: ReposContract;
  repoGroups: RepoGroupsContract;
  prs: PullRequestsContract;
  issues: IssuesContract;
  comments: CommentsContract;
  actions: ActionsContract;
  notifications: NotificationsContract;
  offlineActions: OfflineActionsContract;
  branchIntegrity: BranchIntegrityContract;
  sync: SyncContract;
  operations: OperationsContract;
  search: SearchContract;
  health: HealthContract;
  appUpdate: AppUpdateContract;
  settings: SettingsContract;
  cache: CacheContract;
  shell: ShellContract;
  window: WindowContract;
}

export interface StartupContract {
  snapshot(): Promise<StartupSnapshot>;
}

export interface StartupSnapshot {
  auth: AuthState;
  profiles: GitHubAccountSession[];
  activeProfileId: string | null;
  repos: WatchedRepo[];
  cacheSummary: CacheSummary | null;
  selectedRepoId: string | null;
  windowContext: FallbackWindowContext | null;
  cachedAt: string;
}

export interface PerformanceContract {
  rendererReady(metrics?: RendererReadyMetrics): void;
}

export interface RendererReadyMetrics {
  htmlScriptMs?: number;
  moduleLoadedMs?: number;
  rootRenderCalledMs?: number;
  shellPaintMs?: number;
  rendererReadySentMs?: number;
  rendererReadyEpochMs?: number;
  readyEffectMs?: number;
  domInteractiveMs?: number;
  domContentLoadedMs?: number;
  loadEventEndMs?: number;
  entryImports?: string[];
}

export interface AppEventPayload {
  repoId?: string | null;
}

export interface EventsContract {
  onReposChanged(callback: (payload: AppEventPayload) => void): () => void;
  onProfileChanged(callback: (payload: AppEventPayload) => void): () => void;
  onLocalChangesChanged(callback: (payload: AppEventPayload) => void): () => void;
  onOperationsChanged(callback: (payload: AppEventPayload) => void): () => void;
  onSyncChanged(callback: (payload: AppEventPayload) => void): () => void;
  onNotificationsChanged(callback: (payload: AppEventPayload) => void): () => void;
  onOfflineActionsChanged(callback: (payload: AppEventPayload) => void): () => void;
  onBranchIntegrityChanged(callback: (payload: AppEventPayload) => void): () => void;
  onHealthChanged(callback: (payload: AppEventPayload) => void): () => void;
  onAppUpdateChanged(callback: (payload: AppEventPayload) => void): () => void;
}

export interface AuthContract {
  connectGitHub(token?: string): Promise<void>;
  startGitHubBrowserOAuth(): Promise<GitHubBrowserOAuthFlow>;
  startAddGitHubProfileOAuth(): Promise<GitHubBrowserOAuthFlow>;
  cancelGitHubBrowserOAuth(): Promise<void>;
  onBrowserOAuthResult(callback: (result: GitHubBrowserOAuthResult) => void): () => void;
  startGitHubOAuth(): Promise<GitHubOAuthDeviceFlow>;
  completeGitHubOAuth(deviceCode: string): Promise<GitHubOAuthDeviceCompletion>;
  getAuthState(): Promise<AuthState>;
  listAccounts(): Promise<GitHubAccountSession[]>;
  listProfiles(): Promise<GitHubAccountSession[]>;
  selectAccount(accountId: string): Promise<void>;
  selectProfile(profileId: string): Promise<void>;
  updateProfile(profileId: string, input: { profileName?: string | null; profileColor?: string | null }): Promise<GitHubAccountSession>;
  renameProfile(profileId: string, name: string): Promise<GitHubAccountSession>;
  updateProfileColor(profileId: string, color: string | null): Promise<GitHubAccountSession>;
  reconnectProfile(profileId: string): Promise<GitHubBrowserOAuthFlow>;
  deleteAccount(accountId: string): Promise<void>;
  removeProfile(profileId: string): Promise<void>;
  deleteAllAccounts(): Promise<void>;
  disconnectGitHub(): Promise<void>;
}

export interface ReposContract {
  listAvailable(): Promise<GitHubRepoSummary[]>;
  listWatched(): Promise<WatchedRepo[]>;
  codeSummary(repoId: string): Promise<RepoCodeSummary>;
  listFiles(repoId: string, path?: string): Promise<RepoFileEntry[]>;
  readFile(repoId: string, path: string): Promise<RepoFileContent>;
  listBranches(repoId: string): Promise<RepoBranchSummary[]>;
  switchBranch(repoId: string, branch: string): Promise<RepoBranchSwitchResult>;
  getIdentity(repoId: string, caller?: string): Promise<RepoIdentity>;
  updateIdentity(repoId: string, input: UpdateRepoIdentityInput): Promise<RepoIdentity>;
  applyLocalGitIdentity(repoId: string): Promise<RepoIdentity>;
  signingReadiness(repoId: string): Promise<RepoSigningReadiness>;
  verifySigning(repoId: string): Promise<RepoSigningVerification>;
  checkCredentials(repoId: string): Promise<CredentialDiagnosticReport>;
  commitTemplates(repoId: string): Promise<CommitTemplate[]>;
  searchCommits(repoId: string, input: CommitSearchInput): Promise<CommitSearchResult>;
  cancelCommitSearch(requestId: string): Promise<boolean>;
  commitGraph(repoId: string, options?: CommitGraphOptions): Promise<CommitGraphViewModel>;
  commitGraphPatch(repoId: string, sha: string): Promise<CommitGraphPatch>;
  listWorkspaces(repoId: string): Promise<RepoWorkspace[]>;
  refreshWorkspaces(repoId: string): Promise<RepoWorkspace[]>;
  switchWorkspace(repoId: string, workspaceId: string): Promise<RepoWorkspace>;
  createWorkspace(repoId: string, input: CreateRepoWorkspaceInput): Promise<RepoWorkspace>;
  removeWorkspace(repoId: string, workspaceId: string, input?: RemoveRepoWorkspaceInput): Promise<RepoWorkspace[]>;
  pruneWorkspaces(repoId: string): Promise<RepoWorkspace[]>;
  gitNetworkPreflight(repoId: string): Promise<LocalGitNetworkPreflight>;
  fetchWorkspace(repoId: string): Promise<LocalGitNetworkResult>;
  pullWorkspace(repoId: string, input?: LocalGitPullInput): Promise<LocalGitNetworkResult>;
  pushWorkspace(repoId: string): Promise<LocalGitNetworkResult>;
  publishWorkspace(repoId: string, input?: LocalGitPublishInput): Promise<LocalGitNetworkResult>;
  conflictPreflight(repoId: string, input: LocalGitConflictPreflightInput): Promise<LocalGitConflictPreflight>;
  conflictState(repoId: string): Promise<LocalGitConflictState>;
  abortConflict(repoId: string, input?: LocalGitConflictAbortInput): Promise<LocalGitConflictState>;
  resolveConflictFile(repoId: string, input: LocalGitConflictResolveInput): Promise<LocalGitConflictResolveResult>;
  openConflictFile(repoId: string, path: string): Promise<void>;
  openMergeTool(repoId: string, path: string): Promise<LocalGitConflictState>;
  localChanges(repoId: string): Promise<LocalChangesState>;
  localChangesOverview(repoId: string): Promise<LocalChangesState>;
  localChangePatch(repoId: string, path: string): Promise<LocalChangePatch>;
  localChangesSummary(repoIds?: string[], options?: { includeStats?: boolean }): Promise<LocalChangesSummary[]>;
  applyLocalPatch(repoId: string, input: LocalPatchApplyInput): Promise<LocalChangesState>;
  fileHistory(repoId: string, path: string): Promise<LocalFileHistory>;
  fileBlame(repoId: string, path: string): Promise<LocalFileBlame>;
  stageLocalFile(repoId: string, path: string): Promise<LocalChangesState>;
  unstageLocalFile(repoId: string, path: string): Promise<LocalChangesState>;
  stageAllLocalChanges(repoId: string): Promise<LocalChangesState>;
  unstageAllLocalChanges(repoId: string): Promise<LocalChangesState>;
  discardLocalFile(repoId: string, path: string): Promise<LocalChangesState>;
  revertCommit(repoId: string, sha: string): Promise<LocalChangesState>;
  commitLocalChanges(repoId: string, input: LocalCommitInput): Promise<LocalCommitResult>;
  stashLocalChanges(repoId: string, message?: string): Promise<LocalChangesState>;
  stashLocalFiles(repoId: string, paths: string[], message?: string): Promise<LocalChangesState>;
  stashDetail(repoId: string, stashRef: string): Promise<LocalStashDetail>;
  applyStash(repoId: string, stashRef: string): Promise<LocalChangesState>;
  popStash(repoId: string, stashRef: string): Promise<LocalChangesState>;
  dropStash(repoId: string, stashRef: string): Promise<LocalChangesState>;
  listReleases(repoId: string): Promise<RepoReleaseSummary[]>;
  listTags(repoId: string): Promise<RepoTagSummary[]>;
  listContributors(repoId: string): Promise<RepoContributorSummary[]>;
  watch(input: WatchRepoInput): Promise<WatchedRepo>;
  unwatch(repoId: string): Promise<void>;
  refresh(repoId: string): Promise<SyncJob>;
  refreshAll(): Promise<SyncJob[]>;
}

export interface RepoGroupsContract {
  list(): Promise<RepoGroup[]>;
  create(input: UpdateRepoGroupsInput): Promise<RepoGroup>;
  update(groupId: string, input: UpdateRepoGroupsInput): Promise<RepoGroup>;
  delete(groupId: string): Promise<void>;
  setMemberships(groupId: string, repoIds: string[]): Promise<RepoGroup>;
}

export interface PullRequestsContract {
  list(repoId: string, filters?: PRFilters): Promise<PullRequestSummary[]>;
  listMine(): Promise<PullRequestSummary[]>;
  get(repoId: string, number: number): Promise<PullRequestDetail | null>;
  getDiff(repoId: string, number: number): Promise<PullRequestDiff>;
  addComment(repoId: string, number: number, body: string, options?: { clientOnline?: boolean }): Promise<WritebackSubmitResult>;
  submitReview(
    repoId: string,
    number: number,
    input: SubmitPullRequestReviewInput,
    options?: { clientOnline?: boolean }
  ): Promise<WritebackSubmitResult>;
  getReviewDraft(repoId: string, number: number): Promise<PullRequestReviewDraft | null>;
  updateReviewDraft(repoId: string, number: number, input: UpdatePullRequestReviewDraftInput): Promise<PullRequestReviewDraft>;
  clearReviewDraft(repoId: string, number: number, headSha?: string | null): Promise<void>;
  refresh(repoId: string, number: number): Promise<SyncJob>;
  refreshMine(): Promise<SyncJob>;
}

export interface IssuesContract {
  list(repoId: string, filters?: IssueListInput): Promise<IssueListResult>;
  listMine(): Promise<IssueSummary[]>;
  get(repoId: string, number: number): Promise<IssueDetail | null>;
  addComment(repoId: string, number: number, body: string, options?: { clientOnline?: boolean }): Promise<WritebackSubmitResult>;
  refresh(repoId: string, number: number): Promise<SyncJob>;
}

export interface CommentsContract {
  listRecent(repoId: string): Promise<TimelineComment[]>;
}

export interface ActionsContract {
  listChecks(repoId: string): Promise<ActionCheckSummary[]>;
  listWorkflowRuns(repoId: string): Promise<WorkflowRunSummary[]>;
}

export interface NotificationsContract {
  summary(): Promise<AttentionSummary>;
  list(input?: AttentionListInput): Promise<AttentionItem[]>;
  markRead(ids: string[]): Promise<void>;
  markAllRead(input?: AttentionListInput): Promise<void>;
  markDone(id: string): Promise<void>;
  undoDone(id: string): Promise<void>;
  snooze(id: string, until: string): Promise<void>;
  unsnooze(id: string): Promise<void>;
  mute(id: string, until?: string | null): Promise<void>;
  unmute(id: string): Promise<void>;
  refresh(): Promise<SyncJob>;
}

export interface OfflineActionsContract {
  list(input?: OfflineActionListInput): Promise<OfflineAction[]>;
  get(id: string): Promise<OfflineAction | null>;
  summary(): Promise<OfflineActionQueueSummary>;
  update(id: string, input: UpdateOfflineActionInput): Promise<OfflineAction>;
  cancel(id: string): Promise<OfflineAction>;
  retry(id: string): Promise<void>;
  flush(): Promise<void>;
  onChanged(callback: (payload: AppEventPayload) => void): () => void;
}

export interface BranchIntegrityContract {
  auditRepo(repoId: string, options?: BranchIntegrityAuditOptions): Promise<BranchIntegrityAuditResult>;
  auditAll(options?: BranchIntegrityAuditOptions): Promise<BranchIntegrityAuditSummary>;
  latestFindings(repoId?: string): Promise<BranchIntegrityFinding[]>;
  summary(repoId: string): Promise<BranchIntegrityStatusSummary>;
  summaryMany(repoIds: string[]): Promise<BranchIntegrityStatusSummary[]>;
  markResolved(findingId: string): Promise<BranchIntegrityFinding | null>;
  recordSnapshot(repoId: string, options?: BranchIntegrityAuditOptions): Promise<BranchSnapshot>;
  fetchSafetyRefs(repoId: string): Promise<boolean>;
  recoveryPlan(repoId: string, findingIds: string[]): Promise<BranchRecoveryPlan>;
  inspectDiff(repoId: string, findingId: string, mode?: "landed" | "expected" | "recovery"): Promise<PullRequestDiff>;
  createRecoveryBranch(repoId: string, findingIds: string[], strategy?: BranchRecoveryPlan["strategy"]): Promise<BranchRecoveryResult>;
  openRecoveryPullRequest(repoId: string, findingIds: string[]): Promise<BranchRecoveryPullRequest>;
}

export interface SyncContract {
  setActiveContext(context: SyncActiveContext): Promise<void>;
}

export interface OperationsContract {
  listRecent(repoId?: string): Promise<OperationRecord[]>;
  cancel(operationId: string): Promise<OperationRecord | null>;
}

export interface SearchContract {
  query(q: string, filters?: SearchFilters): Promise<SearchResult[]>;
}

export interface HealthContract {
  summary(): Promise<GitHubHealthSummary>;
  runProbe(repoId?: string): Promise<HealthProbeResult[]>;
  matrix(): Promise<HealthMatrixRow[]>;
  history(): Promise<HealthHistory>;
  offlineStatus(): Promise<OfflineStatus>;
}

export interface AppUpdateContract {
  getState(): Promise<AppUpdateState>;
  check(): Promise<AppUpdateCheckResult>;
  download(): Promise<AppUpdateActionResult>;
  install(): Promise<AppUpdateActionResult>;
}

export interface SettingsContract {
  get(): Promise<AppSettings>;
  update(patch: Partial<AppSettings>): Promise<AppSettings>;
}

export interface CacheContract {
  summary(): Promise<CacheSummary>;
  summaryDetailed(): Promise<CacheSummary>;
  deleteRepo(repoId: string): Promise<CacheSummary>;
  deleteAll(): Promise<CacheSummary>;
  exportDiagnostics(includeSensitive?: boolean): Promise<DiagnosticsExport>;
}

export interface ShellContract {
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  openEditor(path: string): Promise<void>;
  openEditorAtLine(path: string, line?: number | null, workspacePath?: string | null): Promise<void>;
  openTerminal(path: string): Promise<void>;
  revealPath(path: string): Promise<void>;
}

export interface WindowContract {
  context(): Promise<FallbackWindowContext>;
  updateContext(input: FallbackWindowContextInput): Promise<FallbackWindowContext>;
  openContext(input: FallbackWindowContextInput): Promise<FallbackWindowContext>;
  listContexts(): Promise<FallbackWindowContext[]>;
  close(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
}
