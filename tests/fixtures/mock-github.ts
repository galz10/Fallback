import type { GitHubRateLimit } from "../../electron/main/github-client.js";

export class MockGitHubClient {
  rateLimit: GitHubRateLimit | null = { remaining: 5000, resetAt: new Date(Date.now() + 60_000).toISOString() };
  readonly calls = new Map<string, number>();

  getRateLimit(): GitHubRateLimit | null {
    return this.rateLimit;
  }

  callCount(method: string, apiPath: string): number {
    return this.calls.get(`${method.toUpperCase()} ${apiPath}`) ?? 0;
  }

  clearCalls(): void {
    this.calls.clear();
  }

  protected recordCall(method: string, apiPath: string): void {
    const key = `${method.toUpperCase()} ${apiPath}`;
    this.calls.set(key, (this.calls.get(key) ?? 0) + 1);
  }
}
