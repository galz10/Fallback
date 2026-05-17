import type { CredentialDiagnosticStatus, RepoRemoteProtocol } from "./repo-identity.js";

export type LocalGitNetworkAction = "fetch" | "pull" | "push" | "publish";

export type LocalGitPullStrategy = "ff-only" | "merge" | "rebase";

export type LocalGitConflictOperation = "pull" | "merge" | "rebase" | "stash_apply" | "stash_pop" | "branch_switch" | "workspace_switch";

export type LocalGitConflictRiskLevel = "none" | "low" | "medium" | "high";

export type LocalGitConflictStateKind = "none" | "merge" | "rebase" | "cherry_pick" | "revert";

export type LocalGitConflictFileStatus =
  | "both_modified"
  | "both_added"
  | "deleted_by_us"
  | "deleted_by_them"
  | "added_by_us"
  | "added_by_them"
  | "renamed"
  | "unmerged";

export type LocalGitNetworkStatus =
  | "ready"
  | "up_to_date"
  | "ahead"
  | "behind"
  | "diverged"
  | "stale"
  | "dirty_worktree"
  | "no_upstream"
  | "offline"
  | "auth_failed"
  | "rejected"
  | "protected_branch"
  | "non_fast_forward"
  | "conflict"
  | "remote_unavailable"
  | "detached"
  | "unknown";

export interface LocalGitNetworkLabels {
  fetch: string;
  pull: string;
  push: string;
  publish: string;
}

export interface LocalGitNetworkPreflight {
  repoId: string;
  repoFullName: string;
  workspacePath: string;
  identityLabel: string;
  branch: string | null;
  headSha: string | null;
  upstream: string | null;
  upstreamRemote: string | null;
  upstreamBranch: string | null;
  remoteUrl: string | null;
  remoteProtocol: RepoRemoteProtocol;
  ahead: number | null;
  behind: number | null;
  isDirty: boolean;
  hasUpstream: boolean;
  pullStrategy: LocalGitPullStrategy;
  credentialStatus: CredentialDiagnosticStatus;
  credentialSummary: string | null;
  branchProtectionHint: string | null;
  signingPolicyHint: string | null;
  status: LocalGitNetworkStatus;
  statusMessage: string;
  actionLabels: LocalGitNetworkLabels;
  generatedAt: string;
}

export interface LocalGitPullInput {
  strategy?: LocalGitPullStrategy;
}

export interface LocalGitPublishInput {
  branchName?: string;
  remote?: string;
}

export interface LocalGitNetworkResult {
  repoId: string;
  action: LocalGitNetworkAction;
  branch: string | null;
  upstream: string | null;
  beforeHeadSha: string | null;
  afterHeadSha: string | null;
  ahead: number | null;
  behind: number | null;
  status: LocalGitNetworkStatus;
  message: string;
  diagnosticsRecommended: boolean;
  preflight: LocalGitNetworkPreflight;
}

export interface LocalGitConflictFile {
  path: string;
  previousPath: string | null;
  status: LocalGitConflictFileStatus;
  stages: number[];
  isBinary: boolean;
  isLfsPointer: boolean;
  cue: string | null;
}

export interface LocalGitConflictState {
  repoId: string;
  repoFullName: string;
  workspacePath: string;
  branch: string | null;
  headSha: string | null;
  state: LocalGitConflictStateKind;
  isActive: boolean;
  operationLabel: string;
  files: LocalGitConflictFile[];
  fileCount: number;
  binaryCount: number;
  lfsCount: number;
  recoveryHint: string | null;
  generatedAt: string;
}

export interface LocalGitConflictRiskFile {
  path: string;
  dirty: boolean;
  touchedByTarget: boolean;
  isBinary: boolean;
  isLfsPointer: boolean;
  cue: string | null;
}

export interface LocalGitConflictPreflightInput {
  operation: LocalGitConflictOperation;
  targetRef?: string | null;
  stashRef?: string | null;
}

export interface LocalGitConflictPreflight {
  repoId: string;
  repoFullName: string;
  workspacePath: string;
  branch: string | null;
  operation: LocalGitConflictOperation;
  targetRef: string | null;
  riskLevel: LocalGitConflictRiskLevel;
  summary: string;
  dirtyFileCount: number;
  overlappingFileCount: number;
  targetFileCount: number;
  binaryFileCount: number;
  lfsFileCount: number;
  staleBase: boolean;
  diverged: boolean;
  activeConflict: LocalGitConflictState;
  files: LocalGitConflictRiskFile[];
  safeAlternatives: string[];
  generatedAt: string;
}

export interface LocalGitConflictAbortInput {
  state?: Exclude<LocalGitConflictStateKind, "none">;
}

export interface LocalGitConflictResolveInput {
  path: string;
  contents: string;
}

export interface LocalGitConflictResolveResult {
  changes: LocalChangesState;
  conflictState: LocalGitConflictState;
  staged: boolean;
  remainingMarkers: boolean;
}

export type LocalChangeStatus = "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked";

export interface LocalChangeFile {
  path: string;
  previousPath: string | null;
  status: LocalChangeStatus;
  staged: boolean;
  unstaged: boolean;
  additions: number;
  deletions: number;
}

export interface LocalStashEntry {
  ref: string;
  message: string;
  date: string | null;
  files: number;
}

export interface LocalStashFile {
  path: string;
  previousPath: string | null;
  status: LocalChangeStatus;
  additions: number;
  deletions: number;
}

export interface LocalStashDetail {
  ref: string;
  sha: string;
  branch: string | null;
  baseSha: string | null;
  baseMessage: string | null;
  date: string | null;
  message: string;
  files: LocalStashFile[];
  patch: string;
}

export interface LocalChangesState {
  repoId: string;
  branch: string;
  isDirty: boolean;
  files: LocalChangeFile[];
  additions: number;
  deletions: number;
  patch: string;
  stashes: LocalStashEntry[];
  createdStashRef?: string | null;
}

export interface LocalChangePatch {
  repoId: string;
  path: string;
  previousPath: string | null;
  patch: string;
  stagedPatch?: string;
  unstagedPatch?: string;
  conflictContents?: string;
  conflictMarkerCount?: number;
  preview?: LocalChangeFilePreview;
  generatedAt: string;
}

export type LocalPatchApplyAction = "stage" | "unstage" | "discard";

export interface LocalPatchApplyInput {
  action: LocalPatchApplyAction;
  path: string;
  patch: string;
  selectionKind: "hunk" | "lines";
}

export interface LocalFileHistoryEntry {
  sha: string;
  shortSha: string;
  authorName: string | null;
  authorEmail: string | null;
  authoredAt: string | null;
  subject: string;
}

export interface LocalFileHistory {
  repoId: string;
  path: string;
  entries: LocalFileHistoryEntry[];
  renameCaveat: string | null;
  generatedAt: string;
}

export interface LocalFileBlameLine {
  lineNumber: number;
  sha: string;
  shortSha: string;
  authorName: string | null;
  authorEmail: string | null;
  authoredAt: string | null;
  summary: string | null;
  content: string;
}

export interface LocalFileBlame {
  repoId: string;
  path: string;
  branch: string | null;
  lines: LocalFileBlameLine[];
  generatedAt: string;
}

export type LocalChangePreviewKind = "text" | "image" | "binary" | "lfs" | "too_large" | "deleted" | "missing" | "permission_error";

export interface LocalChangeFilePreview {
  kind: LocalChangePreviewKind;
  path: string;
  previousPath: string | null;
  mimeType: string | null;
  fileSize: number | null;
  isImage: boolean;
  isBinary: boolean;
  isLfsPointer: boolean;
  isGenerated: boolean;
  isTooLarge: boolean;
  currentDataUrl: string | null;
  previousDataUrl: string | null;
  message: string | null;
}

export interface LocalChangesSummary {
  repoId: string;
  branch: string | null;
  isDirty: boolean;
  fileCount: number;
  additions: number;
  deletions: number;
  error: string | null;
}

export interface LocalCommitInput {
  summary: string;
  description?: string;
  bypassIdentityWarning?: boolean;
}

export interface LocalCommitResult {
  sha: string;
  message: string;
}

export type CommitTemplateSource = "git" | "fallback" | "builtin";

export interface CommitTemplate {
  id: string;
  name: string;
  body: string;
  source: CommitTemplateSource;
  scope: "repo" | "global";
  path: string | null;
  repoId: string | null;
}
