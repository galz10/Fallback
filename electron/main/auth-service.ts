import { randomUUID } from "node:crypto";
import type {
  AuthState,
  GitHubAccountSession,
  GitHubBrowserOAuthFlow,
  GitHubOAuthDeviceCompletion,
  GitHubOAuthDeviceFlow
} from "../../src/shared/domain/auth.js";
import type { AvatarCacheService } from "./avatar-cache-service.js";
import { bundledGitHubOAuthClientId } from "./build-config.generated.js";
import type { DatabaseService } from "./database-service.js";
import { classifyAuthFailure, errorMessage, isNetworkError, type AuthFailure } from "./error-classification.js";
import { GitHubClient, type GitHubUser } from "./github-client.js";
import { TokenService } from "./token-service.js";
import type { WorkspaceService } from "./workspace-service.js";

const deviceGrantType = "urn:ietf:params:oauth:grant-type:device_code";
const oauthScope = "repo read:user read:org";
const dotComEndpoint = "https://api.github.com";
const browserOAuthRedirectUri = "fallback://oauth";
const browserOAuthSessionMs = 10 * 60 * 1000;
const cachedAuthValidationMs = 15 * 60_000;

interface BrowserOAuthSession {
  state: string;
  endpoint: string;
  redirectUri: string;
  startedAt: number;
  expiresAt: number;
  scopes: string[];
  mode: "connect" | "add_profile" | "reconnect_profile";
  targetAccountId?: string | null;
}

export class AuthService {
  private cachedUser: GitHubUser | null = null;
  private cachedAccount: GitHubAccountSession | null = null;
  private cachedAuthState: { value: AuthState; expiresAt: number } | null = null;
  private authStateInFlight: Promise<AuthState> | null = null;
  private authStateGeneration = 0;
  private browserOAuthSession: BrowserOAuthSession | null = null;

  constructor(
    private readonly token: TokenService,
    private readonly github: GitHubClient,
    private readonly database?: DatabaseService,
    private readonly avatarCache?: AvatarCacheService,
    private readonly workspace?: WorkspaceService
  ) {}

  async connectGitHub(token?: string): Promise<void> {
    return this.withAuthDiagnostics("connect_failed", async () => {
      const accessToken = token?.trim();
      if (!accessToken) throw new Error("A GitHub token is required.");
      const user = await new GitHubClient(accessToken, { apiEndpoint: dotComEndpoint }).get<GitHubUser>("/user");
      const account = this.setCachedUser(user, null, dotComEndpoint);
      await this.token.setToken(accessToken, account);
      this.markTokenSource(account, "keychain");
      await this.migrateLegacyToken(account);
      this.clearAuthStateCache();
    });
  }

  async startGitHubOAuth(): Promise<GitHubOAuthDeviceFlow> {
    return this.withAuthDiagnostics("oauth_start_failed", async () => {
      const clientId = githubOAuthClientId();
      if (!clientId) throw new Error("GITHUB_CLIENT_ID is required to start GitHub OAuth.");

      const body = await postGitHubOAuth<GitHubDeviceCodeResponse>("https://github.com/login/device/code", {
        client_id: clientId,
        scope: oauthScope
      });
      if (!body.device_code || !body.user_code || !body.verification_uri || !body.expires_in)
        throw new Error(oauthErrorMessage(body, "GitHub OAuth device flow failed to start."));

      return {
        deviceCode: body.device_code,
        userCode: body.user_code,
        verificationUri: body.verification_uri,
        verificationUriComplete: body.verification_uri_complete ?? null,
        expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
        intervalSeconds: body.interval ?? 5
      };
    });
  }

  async startGitHubBrowserOAuth(): Promise<GitHubBrowserOAuthFlow> {
    return this.startBrowserOAuthSession("connect");
  }

  async startAddGitHubProfileOAuth(): Promise<GitHubBrowserOAuthFlow> {
    return this.startBrowserOAuthSession("add_profile");
  }

  async reconnectProfile(profileId: string): Promise<GitHubBrowserOAuthFlow> {
    const profile = this.database?.localCache.accounts.getGitHubAccountById(profileId);
    if (!profile) throw new Error("GitHub profile not found.");
    return this.startBrowserOAuthSession("reconnect_profile", profile.id);
  }

  private async startBrowserOAuthSession(
    mode: BrowserOAuthSession["mode"],
    targetAccountId?: string | null
  ): Promise<GitHubBrowserOAuthFlow> {
    return this.withAuthDiagnostics("browser_oauth_start_failed", async () => {
      const clientId = githubOAuthClientId();
      if (!clientId) throw new Error("GITHUB_CLIENT_ID is required to start GitHub OAuth.");

      const scopes = oauthScope.split(" ");
      const state = randomUUID();
      const expiresAt = Date.now() + browserOAuthSessionMs;
      this.browserOAuthSession = {
        state,
        endpoint: dotComEndpoint,
        redirectUri: browserOAuthRedirectUri,
        startedAt: Date.now(),
        expiresAt,
        scopes,
        mode,
        targetAccountId
      };

      return {
        state,
        authorizationUrl: buildGitHubBrowserOAuthAuthorizationUrl({
          clientId,
          redirectUri: browserOAuthRedirectUri,
          scopes,
          state
        }),
        redirectUri: browserOAuthRedirectUri,
        expiresAt: new Date(expiresAt).toISOString(),
        endpoint: dotComEndpoint,
        scopes
      };
    });
  }

  async completeGitHubOAuth(deviceCode: string): Promise<GitHubOAuthDeviceCompletion> {
    const clientId = githubOAuthClientId();
    if (!clientId) throw new Error("GITHUB_CLIENT_ID is required to complete GitHub OAuth.");
    if (!deviceCode.trim()) throw new Error("GitHub OAuth device code is required.");

    const body = await postGitHubOAuth<GitHubDeviceTokenResponse>("https://github.com/login/oauth/access_token", {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: deviceGrantType
    });
    if (!body.access_token) {
      if (isExpectedDeviceFlowWait(body)) {
        return {
          status: body.error === "slow_down" ? "slow_down" : "pending",
          message: oauthErrorMessage(body, "GitHub authorization is still pending.")
        };
      }
      const message = oauthErrorMessage(body, "GitHub OAuth did not return an access token.");
      this.recordAuthError("oauth_complete_failed", new Error(message));
      throw new Error(message);
    }

    const user = await new GitHubClient(body.access_token, { apiEndpoint: dotComEndpoint }).get<GitHubUser>("/user");
    const account = this.setCachedUser(user, null, dotComEndpoint);
    await this.token.setToken(body.access_token, account);
    this.markTokenSource(account, "keychain");
    await this.migrateLegacyToken(account);
    this.clearAuthStateCache();
    return { status: "success" };
  }

  async completeGitHubBrowserOAuth(callbackUrl: string): Promise<void> {
    return this.withAuthDiagnostics("browser_oauth_complete_failed", async () => {
      const session = this.browserOAuthSession;
      if (!session) throw new Error("No GitHub browser sign-in is waiting for a callback.");
      if (Date.now() > session.expiresAt) {
        this.browserOAuthSession = null;
        throw new Error("GitHub browser sign-in expired. Start a new sign-in.");
      }

      const callback = parseGitHubBrowserOAuthCallback(callbackUrl);
      if (callback.error) {
        this.browserOAuthSession = null;
        throw new Error(callback.errorDescription ?? callback.error);
      }
      if (!callback.state || callback.state !== session.state) {
        throw new Error("GitHub OAuth state did not match the active sign-in.");
      }
      if (!callback.code) {
        this.browserOAuthSession = null;
        throw new Error("GitHub OAuth callback did not include a code.");
      }

      const clientId = githubOAuthClientId();
      if (!clientId) throw new Error("GITHUB_CLIENT_ID is required to complete GitHub OAuth.");
      const tokenParams: Record<string, string> = {
        client_id: clientId,
        code: callback.code,
        redirect_uri: session.redirectUri
      };
      const clientSecret = githubOAuthClientSecret();
      if (clientSecret) tokenParams.client_secret = clientSecret;

      const body = await postGitHubOAuth<GitHubDeviceTokenResponse>("https://github.com/login/oauth/access_token", tokenParams);
      if (!body.access_token) throw new Error(oauthErrorMessage(body, "GitHub OAuth did not return an access token."));

      const user = await new GitHubClient(body.access_token, { apiEndpoint: session.endpoint }).get<GitHubUser>("/user");
      if (session.mode === "reconnect_profile" && session.targetAccountId) {
        const target = this.database?.localCache.accounts.getGitHubAccountById(session.targetAccountId);
        if (!target || target.githubUserId !== String(user.id)) {
          throw new Error("Reconnect token belongs to a different GitHub account. Use Add profile instead.");
        }
      }
      const account = this.setCachedUser(user, null, session.endpoint);
      await this.token.setToken(body.access_token, account);
      this.markTokenSource(account, "keychain");
      await this.migrateLegacyToken(account);
      this.browserOAuthSession = null;
      this.clearAuthStateCache();
    });
  }

  async cancelGitHubBrowserOAuth(): Promise<void> {
    this.browserOAuthSession = null;
  }

  async getAuthState(): Promise<AuthState> {
    if (this.cachedAuthState && this.cachedAuthState.expiresAt > Date.now()) return this.cachedAuthState.value;
    const cachedAccount = this.cachedAccount ?? this.database?.localCache.accounts.getGitHubAccount() ?? null;
    if (cachedAccount?.tokenSource && cachedAccount.authStatus === "connected" && isValidationFresh(cachedAccount.lastValidatedAt)) {
      const value = this.connectedAuthState(cachedAccount, cachedAccount.tokenSource);
      this.cachedAccount = cachedAccount;
      this.cachedAuthState = { value, expiresAt: Date.now() + cachedAuthValidationMs };
      this.refreshAuthStateInBackground();
      return value;
    }
    if (this.authStateInFlight) return this.authStateInFlight;
    const generation = this.authStateGeneration;
    this.authStateInFlight = this.validateCurrentAccount(generation)
      .then((value) => {
        if (generation === this.authStateGeneration) {
          this.cachedAuthState = { value, expiresAt: Date.now() + cachedAuthValidationMs };
        }
        return value;
      })
      .finally(() => {
        this.authStateInFlight = null;
      });
    return this.authStateInFlight;
  }

  private refreshAuthStateInBackground(): void {
    if (this.authStateInFlight) return;
    const generation = this.authStateGeneration;
    this.authStateInFlight = this.validateCurrentAccount(generation)
      .then((value) => {
        if (generation === this.authStateGeneration) {
          this.cachedAuthState = { value, expiresAt: Date.now() + cachedAuthValidationMs };
        }
        return value;
      })
      .catch((error) => {
        this.recordAuthError("auth_background_validation_failed", error);
        return this.cachedAuthState?.value ?? ({ status: "disconnected" } satisfies AuthState);
      })
      .finally(() => {
        this.authStateInFlight = null;
      });
  }

  async validateCurrentAccount(validationGeneration = this.authStateGeneration): Promise<AuthState> {
    const account = this.cachedAccount ?? this.database?.localCache.accounts.getGitHubAccount() ?? null;
    const source = await this.token.getSource(account);
    if (!source) return { status: "disconnected" };

    if (account) {
      try {
        const user = await this.token.withAccount(account, () => this.github.get<GitHubUser>("/user"));
        if (!this.isCurrentAuthValidation(validationGeneration, account.id)) return this.currentCachedAuthState();
        const validatedAt = new Date().toISOString();
        const scopes = this.github.getOAuthScopes() ?? (account.tokenScopes.length > 0 ? account.tokenScopes : oauthScope.split(" "));
        this.cachedUser = user;
        this.cachedAccount = {
          ...account,
          login: user.login,
          htmlUrl: user.html_url ?? account.htmlUrl,
          avatarUrl: user.avatar_url,
          name: user.name ?? account.name,
          accountType: user.type === "Organization" ? "Organization" : "User",
          tokenSource: source,
          tokenScopes: scopes,
          authStatus: "connected",
          lastValidatedAt: validatedAt,
          updatedAt: validatedAt
        };
        const savedAccount = this.database?.localCache.accounts.upsertGitHubAccount({
          id: user.id,
          login: user.login,
          endpoint: account.endpoint,
          htmlUrl: user.html_url ?? account.htmlUrl,
          avatarUrl: user.avatar_url,
          name: user.name ?? account.name,
          accountType: user.type === "Organization" ? "Organization" : "User",
          tokenSource: source,
          tokenScopes: scopes,
          authStatus: "connected",
          lastValidatedAt: validatedAt
        });
        if (savedAccount) {
          this.cachedAccount = { ...this.cachedAccount, avatarCachedUrl: savedAccount.avatarCachedUrl };
          void this.cacheAccountAvatar(savedAccount);
        }
        if (source === "keychain") await this.migrateLegacyToken(this.cachedAccount);
        if (account.tokenSource !== source) this.database?.localCache.accounts.setGitHubAccountTokenSource(account.id, source);
        return this.connectedAuthState(this.cachedAccount, source);
      } catch (error) {
        if (!this.isCurrentAuthValidation(validationGeneration, account.id)) return this.currentCachedAuthState();
        if (isNetworkError(error)) {
          this.recordAuthError("auth_validation_network_unreachable", error);
          return this.connectedAuthState({ ...account, tokenSource: source }, source);
        }
        const failure = classifyAuthFailure(error);
        if (!failure) {
          this.recordAuthError("auth_validation_failed", error);
          return this.degradedAuthState(account, {
            status: "unknown_error",
            message: errorMessage(error)
          });
        }
        this.recordAuthError(`auth_${failure.status}`, error);
        this.database?.localCache.accounts.setGitHubAccountAuthState(account.id, {
          authStatus: failure.status,
          lastValidatedAt: new Date().toISOString()
        });
        this.cachedAccount = { ...account, authStatus: failure.status, tokenSource: source, updatedAt: new Date().toISOString() };
        return this.degradedAuthState(this.cachedAccount, failure);
      }
    }

    try {
      const user = await this.github.get<GitHubUser>("/user");
      if (!this.isCurrentAuthValidation(validationGeneration, null)) return this.currentCachedAuthState();
      const account = this.setCachedUser(user, source, dotComEndpoint);
      this.markTokenSource(account, source);
      return this.connectedAuthState(this.cachedAccount ?? account, source);
    } catch (error) {
      const failure = classifyAuthFailure(error) ?? { status: "unknown_error", message: errorMessage(error) };
      this.recordAuthError(`auth_${failure.status}`, error);
      return failure.status === "rate_limited"
        ? { status: "rate_limited", message: failure.message, resetAt: failure.resetAt }
        : { status: failure.status, message: failure.message };
    }
  }

  async listAccounts(): Promise<GitHubAccountSession[]> {
    const accounts = this.database?.localCache.accounts.listGitHubAccounts() ?? [];
    return Promise.all(
      accounts.map(async (account) => ({
        ...account,
        tokenSource: await this.token.getSource(account)
      }))
    );
  }

  async listProfiles(): Promise<GitHubAccountSession[]> {
    return this.listAccounts();
  }

  async selectAccount(accountId: string): Promise<void> {
    const account = this.database?.localCache.accounts.getGitHubAccountById(accountId);
    if (!account) throw new Error("GitHub account not found.");
    const source = await this.token.getSource(account);
    if (!source) throw new Error("No token is available for this GitHub account.");
    const activeAccount = this.database?.localCache.accounts.setActiveGitHubAccount(account.id) ?? account;
    this.cachedUser = null;
    this.cachedAccount = { ...activeAccount, tokenSource: source };
    if (account.tokenSource !== source) this.database?.localCache.accounts.setGitHubAccountTokenSource(account.id, source);
    this.clearAuthStateCache();
  }

  async selectProfile(profileId: string): Promise<void> {
    return this.selectAccount(profileId);
  }

  updateProfile(profileId: string, input: { profileName?: string | null; profileColor?: string | null }): GitHubAccountSession {
    const profile = this.database?.localCache.accounts.updateGitHubProfile(profileId, input);
    if (!profile) throw new Error("GitHub profile not found.");
    if (this.cachedAccount?.id === profile.id) this.cachedAccount = { ...profile, tokenSource: this.cachedAccount.tokenSource };
    this.clearAuthStateCache();
    return profile;
  }

  renameProfile(profileId: string, name: string): GitHubAccountSession {
    return this.updateProfile(profileId, { profileName: name });
  }

  updateProfileColor(profileId: string, color: string | null): GitHubAccountSession {
    return this.updateProfile(profileId, { profileColor: color });
  }

  async disconnectGitHub(): Promise<void> {
    const account = this.cachedAccount ?? this.database?.localCache.accounts.getGitHubAccount() ?? null;
    this.cachedUser = null;
    this.cachedAccount = null;
    await this.token.deleteToken(account).catch((error: unknown) => {
      this.recordAuthError("disconnect_keychain_failed", error);
    });
    if (account) this.database?.localCache.accounts.setGitHubAccountTokenSource(account.id, null);
    this.clearAuthStateCache();
  }

  async deleteAccount(accountId: string): Promise<void> {
    const account = this.database?.localCache.accounts.getGitHubAccountById(accountId);
    if (!account) return;
    const repos = this.database?.localCache.accounts.listRepoFoldersUniquelyWatchedByAccount(accountId) ?? [];
    this.workspace?.removeManagedRepoFolders(repos);
    await this.token.deleteToken(account).catch((error: unknown) => {
      this.recordAuthError("delete_account_keychain_failed", error);
    });
    this.database?.localCache.accounts.deleteGitHubAccount(accountId);
    if (this.cachedAccount?.id === accountId) {
      this.cachedUser = null;
      this.cachedAccount = null;
    }
    this.clearAuthStateCache();
  }

  async removeProfile(profileId: string): Promise<void> {
    return this.deleteAccount(profileId);
  }

  async deleteAllAccounts(): Promise<void> {
    const accounts = this.database?.localCache.accounts.listGitHubAccounts() ?? [];
    const repos = this.database?.localCache.repos.listWatchedRepos() ?? [];
    this.workspace?.removeManagedRepoFolders(repos);
    await this.token.deleteTokens(accounts).catch((error: unknown) => {
      this.recordAuthError("delete_all_accounts_keychain_failed", error);
    });
    this.cachedUser = null;
    this.cachedAccount = null;
    this.database?.localCache.accounts.deleteAllGitHubAccounts();
    this.clearAuthStateCache();
  }

  private clearAuthStateCache(): void {
    this.cachedAuthState = null;
    this.authStateInFlight = null;
    this.authStateGeneration += 1;
  }

  private isCurrentAuthValidation(validationGeneration: number, accountId: string | null): boolean {
    if (validationGeneration !== this.authStateGeneration) return false;
    if (!accountId) return true;
    return (this.cachedAccount ?? this.database?.localCache.accounts.getGitHubAccount() ?? null)?.id === accountId;
  }

  private currentCachedAuthState(): AuthState {
    const account = this.cachedAccount ?? this.database?.localCache.accounts.getGitHubAccount() ?? null;
    if (!account?.tokenSource) return { status: "disconnected" };
    return this.connectedAuthState(account, account.tokenSource);
  }

  private async withAuthDiagnostics<T>(code: string, task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (error) {
      this.recordAuthError(code, error);
      throw error;
    }
  }

  private recordAuthError(code: string, error: unknown): void {
    try {
      this.database?.localCache.diagnostics.recordDiagnosticEvent({
        source: "auth",
        level: "error",
        code,
        message: errorMessage(error)
      });
    } catch (diagnosticError) {
      console.warn("[auth] failed to record diagnostic event", diagnosticError);
    }
  }

  private setCachedUser(user: GitHubUser, tokenSource: "environment" | "keychain" | null, endpoint: string): GitHubAccountSession {
    this.cachedUser = user;
    const account = this.database?.localCache.accounts.upsertGitHubAccount({
      id: user.id,
      login: user.login,
      endpoint,
      htmlUrl: user.html_url ?? null,
      avatarUrl: user.avatar_url,
      name: user.name ?? null,
      accountType: user.type === "Organization" ? "Organization" : "User",
      tokenSource,
      tokenScopes: oauthScope.split(" "),
      authStatus: "connected",
      lastValidatedAt: new Date().toISOString()
    });
    if (!account) {
      this.cachedAccount = {
        id: `github:${endpoint}:${user.id}`,
        githubUserId: String(user.id),
        login: user.login,
        endpoint,
        htmlUrl: user.html_url ?? null,
        avatarUrl: user.avatar_url,
        avatarCachedUrl: null,
        name: user.name ?? null,
        profileName: user.login,
        profileColor: null,
        accountType: user.type === "Organization" ? "Organization" : "User",
        tokenSource,
        tokenScopes: oauthScope.split(" "),
        authStatus: "connected",
        lastValidatedAt: new Date().toISOString(),
        lastSelectedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      return this.cachedAccount;
    }
    this.cachedAccount = account;
    void this.cacheAccountAvatar(account);
    return account;
  }

  private async cacheAccountAvatar(account: GitHubAccountSession): Promise<void> {
    if (!this.avatarCache || !this.database || !account.avatarUrl) return;
    try {
      const cachedUrl = await this.avatarCache.cacheAccountAvatar(account.id, account.avatarUrl);
      if (!cachedUrl) return;
      const updated = this.database.localCache.accounts.setGitHubAccountAvatarCache(account.id, cachedUrl);
      if (updated && this.cachedAccount?.id === updated.id)
        this.cachedAccount = { ...this.cachedAccount, avatarCachedUrl: updated.avatarCachedUrl };
      this.clearAuthStateCache();
    } catch (error) {
      this.recordAuthError("avatar_cache_failed", error);
    }
  }

  private async migrateLegacyToken(account: GitHubAccountSession): Promise<void> {
    if ("migrateLegacyToken" in this.token && typeof this.token.migrateLegacyToken === "function") {
      await this.token.migrateLegacyToken(account).catch((error: unknown) => {
        this.recordAuthError("legacy_token_migration_failed", error);
      });
    }
  }

  private markTokenSource(account: GitHubAccountSession, tokenSource: "environment" | "keychain" | null): void {
    this.cachedAccount = { ...account, tokenSource, updatedAt: new Date().toISOString() };
    this.database?.localCache.accounts.setGitHubAccountTokenSource(account.id, tokenSource);
  }

  private connectedAuthState(account: GitHubAccountSession, source: "environment" | "keychain"): AuthState {
    return {
      status: "connected",
      source,
      accountId: account.id,
      endpoint: account.endpoint,
      htmlUrl: account.htmlUrl,
      login: account.login ?? undefined,
      avatarUrl: account.avatarUrl,
      avatarCachedUrl: account.avatarCachedUrl,
      name: account.name,
      profileName: account.profileName,
      profileColor: account.profileColor,
      accountType: account.accountType,
      tokenScopes: account.tokenScopes,
      lastValidatedAt: account.lastValidatedAt
    };
  }

  private degradedAuthState(account: GitHubAccountSession, failure: AuthFailure): AuthState {
    const details = {
      message: failure.message,
      accountId: account.id,
      endpoint: account.endpoint,
      htmlUrl: account.htmlUrl,
      login: account.login ?? undefined,
      avatarUrl: account.avatarUrl,
      avatarCachedUrl: account.avatarCachedUrl,
      name: account.name,
      profileName: account.profileName,
      profileColor: account.profileColor,
      accountType: account.accountType,
      tokenScopes: account.tokenScopes,
      lastValidatedAt: account.lastValidatedAt
    };
    return failure.status === "rate_limited"
      ? { status: "rate_limited", ...details, resetAt: failure.resetAt }
      : { status: failure.status, ...details };
  }
}

function githubOAuthClientId(): string {
  return process.env.GITHUB_CLIENT_ID ?? process.env.FALLBACK_GITHUB_CLIENT_ID ?? bundledGitHubOAuthClientId;
}

function isValidationFresh(lastValidatedAt: string | null): boolean {
  if (!lastValidatedAt) return false;
  const validatedAtMs = new Date(lastValidatedAt).getTime();
  return Number.isFinite(validatedAtMs) && Date.now() - validatedAtMs < cachedAuthValidationMs;
}

function githubOAuthClientSecret(): string | undefined {
  return process.env.GITHUB_CLIENT_SECRET ?? process.env.FALLBACK_GITHUB_CLIENT_SECRET;
}

export function buildGitHubBrowserOAuthAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
}): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  return url.toString();
}

export interface GitHubBrowserOAuthCallback {
  code: string | null;
  state: string | null;
  error: string | null;
  errorDescription: string | null;
}

export function parseGitHubBrowserOAuthCallback(callbackUrl: string): GitHubBrowserOAuthCallback {
  const url = new URL(callbackUrl);
  if (url.protocol !== "fallback:" || url.hostname !== "oauth") {
    throw new Error("GitHub OAuth callback used an unexpected URL.");
  }
  return {
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
    error: url.searchParams.get("error"),
    errorDescription: url.searchParams.get("error_description")
  };
}

async function postGitHubOAuth<T extends GitHubOAuthResponse>(url: string, params: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
  const body = (await response.json()) as T;
  if (!response.ok) throw new Error(oauthErrorMessage(body, "GitHub OAuth request failed."));
  return body;
}

interface GitHubOAuthResponse {
  error?: string;
  error_description?: string;
}

interface GitHubDeviceCodeResponse extends GitHubOAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

interface GitHubDeviceTokenResponse extends GitHubOAuthResponse {
  access_token: string;
}

function oauthErrorMessage(body: Partial<GitHubDeviceCodeResponse | GitHubDeviceTokenResponse>, fallback: string): string {
  if (body.error === "authorization_pending") return "GitHub authorization is still pending.";
  if (body.error === "slow_down") return "GitHub asked Fallback to slow down before checking again.";
  if (body.error === "expired_token") return "GitHub OAuth code expired. Start a new sign-in.";
  return body.error_description ?? body.error ?? fallback;
}

function isExpectedDeviceFlowWait(body: Partial<GitHubDeviceCodeResponse | GitHubDeviceTokenResponse>): boolean {
  return body.error === "authorization_pending" || body.error === "slow_down";
}
