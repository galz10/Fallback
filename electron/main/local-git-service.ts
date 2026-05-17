import type {
  CommitTemplate,
  LocalChangePatch,
  LocalChangesState,
  LocalChangesSummary,
  LocalCommitInput,
  LocalCommitResult,
  LocalFileBlame,
  LocalFileHistory,
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
} from "../../src/shared/domain/local-git.js";
import type { PullRequestDiff } from "../../src/shared/domain/github-work.js";
import type {
  BranchCommitObservation,
  BranchRecoveryPlan,
  BranchRecoveryResult,
  BranchSnapshot,
  BranchSnapshotInput
} from "../../src/shared/domain/branch-integrity.js";
import type { DatabaseService } from "./database-service.js";
import type { SettingsService } from "./settings-service.js";
import { BranchIntegrityGitReader } from "./local-git/branch-integrity-git-reader.js";
import { GitConflictInspector } from "./local-git/git-conflict-inspector.js";
import { GitNetworkOperations } from "./local-git/git-network-operations.js";
import { GitNetworkPreflightReader } from "./local-git/git-network-preflight.js";
import { GitRecoverySnapshot } from "./local-git/git-recovery-snapshot.js";
import { LocalChangesReader } from "./local-git/local-changes-reader.js";
import { LocalCommitWorkflow } from "./local-git/local-commit-workflow.js";
import { LocalDiffApply } from "./local-git/local-diff-apply.js";
import { LocalPatchReader } from "./local-git/local-patch-reader.js";
import { LocalStashStore } from "./local-git/local-stash-store.js";
import { disposeLocalGitParserWorker } from "./local-git/git-workflow-helpers.js";
import type { GitCommandOptions, LocalChangesSummaryOptions, LocalGitRecoverySnapshotOptions } from "./local-git/git-workflow-helpers.js";
import type { LocalGitWorkflowDependencies } from "./local-git/workflow-base.js";

export { classifyGitNetworkError, LocalGitConflictError, LocalGitNetworkError } from "./local-git/git-workflow-helpers.js";
export type { GitCommandOptions, LocalChangesSummaryOptions, LocalGitRecoverySnapshotOptions } from "./local-git/git-workflow-helpers.js";

export class LocalGitService {
  private readonly changesReader: LocalChangesReader;
  private readonly patchReader: LocalPatchReader;
  private readonly diffApply: LocalDiffApply;
  private readonly stashStore: LocalStashStore;
  private readonly commitWorkflow: LocalCommitWorkflow;
  private readonly networkPreflight: GitNetworkPreflightReader;
  private readonly networkOperations: GitNetworkOperations;
  private readonly conflictInspector: GitConflictInspector;
  private readonly recovery: GitRecoverySnapshot;
  private readonly branchIntegrity: BranchIntegrityGitReader;

  constructor(database: DatabaseService, settings?: SettingsService, onBackgroundRefresh?: (repoId?: string | null) => void) {
    const deps: LocalGitWorkflowDependencies = {
      database,
      settings,
      onBackgroundRefresh,
      invalidateLocalChangesCache: (repoId) => this.invalidateLocalChangesCache(repoId),
      invalidatePreflightCache: (repoId) => this.invalidatePreflightCache(repoId),
      changesOverview: (repoId) => this.changesOverview(repoId),
      changes: (repoId) => this.changes(repoId),
      gitNetworkPreflight: (repoId) => this.gitNetworkPreflight(repoId),
      loadGitNetworkPreflight: (repoId) => this.networkPreflight.loadGitNetworkPreflight(repoId),
      conflictState: (repoId) => this.conflictState(repoId)
    };
    this.changesReader = new LocalChangesReader(deps);
    this.patchReader = new LocalPatchReader(deps);
    this.diffApply = new LocalDiffApply(deps);
    this.stashStore = new LocalStashStore(deps);
    this.commitWorkflow = new LocalCommitWorkflow(deps);
    this.networkPreflight = new GitNetworkPreflightReader(deps);
    this.networkOperations = new GitNetworkOperations(deps);
    this.conflictInspector = new GitConflictInspector(deps);
    this.recovery = new GitRecoverySnapshot(deps);
    this.branchIntegrity = new BranchIntegrityGitReader(deps);
  }

  dispose(): void {
    disposeLocalGitParserWorker();
  }
  changes(repoId: string): Promise<LocalChangesState> {
    return this.changesReader.changes(repoId);
  }
  changesOverview(repoId: string): Promise<LocalChangesState> {
    return this.changesReader.changesOverview(repoId);
  }
  changePatch(repoId: string, filePath: string): Promise<LocalChangePatch> {
    return this.patchReader.changePatch(repoId, filePath);
  }
  applyLocalPatch(repoId: string, input: LocalPatchApplyInput, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    return this.diffApply.applyLocalPatch(repoId, input, options);
  }
  fileHistory(repoId: string, filePath: string): Promise<LocalFileHistory> {
    return this.patchReader.fileHistory(repoId, filePath);
  }
  fileBlame(repoId: string, filePath: string): Promise<LocalFileBlame> {
    return this.patchReader.fileBlame(repoId, filePath);
  }
  changesSummary(repoIds?: string[], options: LocalChangesSummaryOptions = {}): Promise<LocalChangesSummary[]> {
    return this.changesReader.changesSummary(repoIds, options);
  }
  commitTemplates(repoId: string): Promise<CommitTemplate[]> {
    return this.commitWorkflow.commitTemplates(repoId);
  }
  stageFile(repoId: string, filePath: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    return this.diffApply.stageFile(repoId, filePath, options);
  }
  unstageFile(repoId: string, filePath: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    return this.diffApply.unstageFile(repoId, filePath, options);
  }
  stageAll(repoId: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    return this.diffApply.stageAll(repoId, options);
  }
  unstageAll(repoId: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    return this.diffApply.unstageAll(repoId, options);
  }
  discardFile(repoId: string, filePath: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    return this.diffApply.discardFile(repoId, filePath, options);
  }
  revertCommit(repoId: string, sha: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    return this.diffApply.revertCommit(repoId, sha, options);
  }
  commit(repoId: string, input: LocalCommitInput, options: GitCommandOptions = {}): Promise<LocalCommitResult> {
    return this.commitWorkflow.commit(repoId, input, options);
  }
  stash(repoId: string, message?: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    return this.stashStore.stash(repoId, message, options);
  }
  stashFiles(repoId: string, paths: string[], message?: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    return this.stashStore.stashFiles(repoId, paths, message, options);
  }
  stashDetail(repoId: string, stashRef: string): Promise<LocalStashDetail> {
    return this.stashStore.stashDetail(repoId, stashRef);
  }
  applyStash(repoId: string, stashRef: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    return this.stashStore.applyStash(repoId, stashRef, options);
  }
  popStash(repoId: string, stashRef: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    return this.stashStore.popStash(repoId, stashRef, options);
  }
  dropStash(repoId: string, stashRef: string, options: GitCommandOptions = {}): Promise<LocalChangesState> {
    return this.stashStore.dropStash(repoId, stashRef, options);
  }
  branchSnapshot(input: BranchSnapshotInput): Promise<BranchSnapshot> {
    return this.branchIntegrity.branchSnapshot(input);
  }
  firstParentAudit(
    repoId: string,
    options: { branch?: string; remote?: string; since?: string; until?: string; limit?: number } = {}
  ): Promise<BranchCommitObservation[]> {
    return this.branchIntegrity.firstParentAudit(repoId, options);
  }
  fetchFallbackSafetyRefs(repoId: string, remote = "origin", options: { force?: boolean } = {}): Promise<boolean> {
    return this.branchIntegrity.fetchFallbackSafetyRefs(repoId, remote, options);
  }
  listFallbackSafetyRefs(repoId: string): Promise<Array<{ ref: string; sha: string; treeSha: string | null }>> {
    return this.branchIntegrity.listFallbackSafetyRefs(repoId);
  }
  branchDiff(repoId: string, baseRef: string, targetRef: string, number = 0): Promise<PullRequestDiff> {
    return this.branchIntegrity.branchDiff(repoId, baseRef, targetRef, number);
  }
  createBranchIntegrityRecovery(repoId: string, plan: BranchRecoveryPlan): Promise<BranchRecoveryResult> {
    return this.branchIntegrity.createBranchIntegrityRecovery(repoId, plan);
  }
  pushCurrentBranch(repoId: string, branchName: string): Promise<void> {
    return this.branchIntegrity.pushCurrentBranch(repoId, branchName);
  }
  gitNetworkPreflight(repoId: string): Promise<LocalGitNetworkPreflight> {
    return this.networkPreflight.gitNetworkPreflight(repoId);
  }
  fetchWorkspace(repoId: string, options: GitCommandOptions = {}): Promise<LocalGitNetworkResult> {
    return this.networkOperations.fetchWorkspace(repoId, options);
  }
  pullWorkspace(repoId: string, input: LocalGitPullInput = {}, options: GitCommandOptions = {}): Promise<LocalGitNetworkResult> {
    return this.networkOperations.pullWorkspace(repoId, input, options);
  }
  pushWorkspace(repoId: string, options: GitCommandOptions = {}): Promise<LocalGitNetworkResult> {
    return this.networkOperations.pushWorkspace(repoId, options);
  }
  publishWorkspace(repoId: string, input: LocalGitPublishInput = {}, options: GitCommandOptions = {}): Promise<LocalGitNetworkResult> {
    return this.networkOperations.publishWorkspace(repoId, input, options);
  }
  conflictPreflight(repoId: string, input: LocalGitConflictPreflightInput): Promise<LocalGitConflictPreflight> {
    return this.conflictInspector.conflictPreflight(repoId, input);
  }
  conflictState(repoId: string): Promise<LocalGitConflictState> {
    return this.conflictInspector.conflictState(repoId);
  }
  abortConflict(repoId: string, input: LocalGitConflictAbortInput = {}, options: GitCommandOptions = {}): Promise<LocalGitConflictState> {
    return this.conflictInspector.abortConflict(repoId, input, options);
  }
  conflictFilePath(repoId: string, filePath: string): Promise<string> {
    return this.conflictInspector.conflictFilePath(repoId, filePath);
  }
  resolveConflictFile(
    repoId: string,
    input: LocalGitConflictResolveInput,
    options: GitCommandOptions = {}
  ): Promise<LocalGitConflictResolveResult> {
    return this.conflictInspector.resolveConflictFile(repoId, input, options);
  }
  openMergeTool(repoId: string, filePath: string, options: GitCommandOptions = {}): Promise<LocalGitConflictState> {
    return this.conflictInspector.openMergeTool(repoId, filePath, options);
  }
  recoverySnapshot(repoId: string, options: LocalGitRecoverySnapshotOptions = {}) {
    return this.recovery.recoverySnapshot(repoId, options);
  }

  private invalidateLocalChangesCache(repoId: string): void {
    this.changesReader.invalidate(repoId);
    this.invalidatePreflightCache(repoId);
  }
  private invalidatePreflightCache(repoId: string): void {
    this.networkPreflight.invalidate(repoId);
    this.conflictInspector.invalidate(repoId);
  }
}
