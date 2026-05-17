export type AuthState =
  | { status: "disconnected" }
  | {
      status: "connected";
      source: "environment" | "keychain";
      accountId?: string;
      endpoint?: string;
      htmlUrl?: string | null;
      login?: string;
      avatarUrl?: string | null;
      avatarCachedUrl?: string | null;
      name?: string | null;
      profileName?: string | null;
      profileColor?: string | null;
      accountType?: "User" | "Organization" | null;
      tokenScopes?: string[];
      lastValidatedAt?: string | null;
    }
  | AuthDegradedState;

export interface AuthDegradedState {
  status: "expired" | "revoked" | "insufficient_scope" | "org_sso_required" | "rate_limited" | "unknown_error";
  message: string;
  resetAt?: string | null;
  accountId?: string;
  endpoint?: string;
  htmlUrl?: string | null;
  login?: string;
  avatarUrl?: string | null;
  avatarCachedUrl?: string | null;
  name?: string | null;
  profileName?: string | null;
  profileColor?: string | null;
  accountType?: "User" | "Organization" | null;
  tokenScopes?: string[];
  lastValidatedAt?: string | null;
}

export interface GitHubAccountSession {
  id: string;
  githubUserId: string | null;
  login: string | null;
  endpoint: string;
  htmlUrl: string | null;
  avatarUrl: string | null;
  avatarCachedUrl: string | null;
  name: string | null;
  profileName: string | null;
  profileColor: string | null;
  accountType: "User" | "Organization" | null;
  tokenSource: "environment" | "keychain" | null;
  tokenScopes: string[];
  authStatus: AuthState["status"];
  lastValidatedAt: string | null;
  lastSelectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubOAuthDeviceFlow {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresAt: string;
  intervalSeconds: number;
}

export type GitHubOAuthDeviceCompletion =
  | { status: "success" }
  | { status: "pending"; message: string }
  | { status: "slow_down"; message: string };

export interface GitHubBrowserOAuthFlow {
  state: string;
  authorizationUrl: string;
  redirectUri: string;
  expiresAt: string;
  endpoint: string;
  scopes: string[];
}

export interface GitHubBrowserOAuthResult {
  status: "success" | "error";
  message?: string;
}
