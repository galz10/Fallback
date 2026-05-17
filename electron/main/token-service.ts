import keytar from "keytar";
import { AsyncLocalStorage } from "node:async_hooks";

const serviceName = "Fallback";
const legacyAccountName = "github-oauth-token";

export interface GitHubTokenAccount {
  id?: string | null;
  githubUserId?: string | null;
  login?: string | null;
  endpoint?: string | null;
}

export interface SecureTokenStore {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export class TokenService {
  private readonly accountContext = new AsyncLocalStorage<GitHubTokenAccount | null>();

  constructor(private readonly secureStore: SecureTokenStore = keytar) {}

  async getToken(account?: GitHubTokenAccount | null): Promise<string | undefined> {
    const scopedAccount = account ?? this.accountContext.getStore() ?? null;
    const accountToken = scopedAccount ? await this.secureStore.getPassword(serviceName, accountTokenKey(scopedAccount)) : undefined;
    return accountToken || (await this.secureStore.getPassword(serviceName, legacyAccountName)) || process.env.GITHUB_TOKEN || undefined;
  }

  async setToken(token: string, account?: GitHubTokenAccount | null): Promise<void> {
    await this.secureStore.setPassword(serviceName, account ? accountTokenKey(account) : legacyAccountName, token);
  }

  async deleteToken(account?: GitHubTokenAccount | null): Promise<void> {
    if (account) {
      await this.secureStore.deletePassword(serviceName, accountTokenKey(account));
    }
    await this.secureStore.deletePassword(serviceName, legacyAccountName);
  }

  async deleteTokens(accounts: GitHubTokenAccount[]): Promise<void> {
    for (const account of accounts) {
      await this.secureStore.deletePassword(serviceName, accountTokenKey(account));
    }
    await this.secureStore.deletePassword(serviceName, legacyAccountName);
  }

  async getSource(account?: GitHubTokenAccount | null): Promise<"environment" | "keychain" | null> {
    const scopedAccount = account ?? this.accountContext.getStore() ?? null;
    const token = scopedAccount ? await this.secureStore.getPassword(serviceName, accountTokenKey(scopedAccount)) : undefined;
    if (token) {
      return "keychain";
    }
    const legacyToken = await this.secureStore.getPassword(serviceName, legacyAccountName);
    if (legacyToken) {
      return "keychain";
    }
    if (process.env.GITHUB_TOKEN) {
      return "environment";
    }
    return null;
  }

  withAccount<T>(account: GitHubTokenAccount | null, task: () => Promise<T>): Promise<T> {
    return this.accountContext.run(account, task);
  }

  contextAccount(): GitHubTokenAccount | null | undefined {
    return this.accountContext.getStore();
  }

  currentEndpoint(fallback = "https://api.github.com"): string {
    return this.accountContext.getStore()?.endpoint ?? fallback;
  }

  async migrateLegacyToken(account: GitHubTokenAccount): Promise<boolean> {
    const token = await this.secureStore.getPassword(serviceName, legacyAccountName);
    if (!token) return false;
    const key = accountTokenKey(account);
    const existing = await this.secureStore.getPassword(serviceName, key);
    if (!existing) {
      await this.secureStore.setPassword(serviceName, key, token);
    }
    await this.secureStore.deletePassword(serviceName, legacyAccountName);
    return true;
  }
}

export function accountTokenKey(account: GitHubTokenAccount): string {
  const endpoint = normalizeEndpoint(account.endpoint);
  const accountId = account.githubUserId || account.id || account.login;
  if (!accountId) {
    return `github:${endpoint}:active`;
  }
  return `github:${endpoint}:${accountId}`;
}

function normalizeEndpoint(endpoint: string | null | undefined): string {
  const value = endpoint?.trim() || "https://api.github.com";
  return value.replace(/\/+$/, "").toLowerCase();
}
