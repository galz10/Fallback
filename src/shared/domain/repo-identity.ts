import type { GitHubAccountSession } from "./auth.js";

export type RepoSigningMode = "unknown" | "unsigned" | "gpg" | "ssh" | "pixel";

export type RepoSigningHealth = "unknown" | "unsigned" | "configured" | "missing_key" | "failed";

export type RepoSigningEnforcement = "none" | "repo_policy" | "branch_protection" | "unknown";

export type RepoSigningVerificationStatus = "verified" | "failed" | "skipped";

export type RepoSigningGitHubKeyStatus = "uploaded" | "not_uploaded" | "unknown" | "not_applicable";

export type RepoRemoteProtocol = "unknown" | "https" | "ssh" | "file";

export type RepoIdentityCheckStatus = "unknown" | "ok" | "warning" | "failed";

export interface RepoIdentity {
  repoId: string;
  accountId: string | null;
  accountLogin: string | null;
  accountEndpoint: string;
  accountStatus: GitHubAccountSession["authStatus"] | null;
  gitName: string | null;
  gitEmail: string | null;
  signingMode: RepoSigningMode;
  signingKeyHint: string | null;
  remoteProtocol: RepoRemoteProtocol;
  verifiedEmailStatus: RepoIdentityCheckStatus;
  lastCheckedAt: string | null;
  lastCheckStatus: RepoIdentityCheckStatus;
  currentGitName: string | null;
  currentGitEmail: string | null;
  currentSigningMode?: RepoSigningMode;
  currentSigningKeyHint?: string | null;
  currentGpgProgram?: string | null;
  currentAllowedSignersFile?: string | null;
  signingHealth?: RepoSigningHealth;
  signingHealthMessage?: string | null;
  branch: string | null;
  remoteUrl: string | null;
  localPath: string | null;
  mismatchReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RepoSigningKeyCandidate {
  mode: Extract<RepoSigningMode, "gpg" | "ssh">;
  key: string;
  hint: string;
  source: "git_config" | "ssh_public_key" | "gpg_secret_key";
  canApply: boolean;
}

export interface RepoSigningRequirement {
  required: boolean;
  enforcement: RepoSigningEnforcement;
  source: string;
  detail: string;
  checkedAt: string;
}

export interface RepoSigningVerification {
  status: RepoSigningVerificationStatus;
  summary: string;
  detail: string | null;
  remediation: string | null;
  redactedCommand: string | null;
  commitSha: string | null;
  generatedAt: string;
}

export interface RepoSigningReadinessCheck {
  status: CredentialDiagnosticStatus;
  summary: string;
  detail: string | null;
  remediation: string | null;
  redactedCommand: string | null;
}

export interface RepoSigningReadiness {
  repoId: string;
  repoFullName: string;
  workspacePath: string | null;
  branch: string | null;
  identityLabel: string;
  expectedMode: RepoSigningMode;
  enforcement: RepoSigningEnforcement;
  requirement: RepoSigningRequirement;
  currentMode: RepoSigningMode;
  currentKeyHint: string | null;
  configuredKeyHint: string | null;
  gpgProgram: string | null;
  allowedSignersFile: string | null;
  githubKeyStatus: RepoSigningGitHubKeyStatus;
  signingHealth: RepoSigningHealth;
  signingHealthMessage: string | null;
  satisfiesPolicy: boolean;
  candidates: RepoSigningKeyCandidate[];
  checks: RepoSigningReadinessCheck[];
  generatedAt: string;
}

export interface UpdateRepoIdentityInput {
  accountId?: string | null;
  gitName?: string | null;
  gitEmail?: string | null;
  signingMode?: RepoSigningMode;
  signingKeyHint?: string | null;
  remoteProtocol?: RepoRemoteProtocol;
}

export type CredentialDiagnosticStatus = "ok" | "warning" | "failed" | "unknown";

export type CredentialDiagnosticSurface =
  | "api"
  | "repo_permission"
  | "https_remote"
  | "ssh_remote"
  | "git_binary"
  | "credential_helper"
  | "secret_service"
  | "ssh_agent"
  | "gpg_agent"
  | "open_url"
  | "editor_handoff"
  | "terminal_handoff"
  | "linux_package"
  | "local_identity"
  | "signing"
  | "sso"
  | "network";

export interface CredentialDiagnosticResult {
  surface: CredentialDiagnosticSurface;
  status: CredentialDiagnosticStatus;
  summary: string;
  detail: string | null;
  remediation: string | null;
  redactedCommand: string | null;
  durationMs: number;
}

export interface CredentialDiagnosticReport {
  repoId: string;
  repoFullName: string;
  checkedAt: string;
  overallStatus: CredentialDiagnosticStatus;
  results: CredentialDiagnosticResult[];
}
