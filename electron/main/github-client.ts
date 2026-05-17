export class GitHubClient {
  private rateLimit: GitHubRateLimit | null = null;
  private blockedRateLimit: GitHubRateLimit | null = null;
  private oauthScopes: string[] | null = null;
  private requestChain: Promise<void> = Promise.resolve();
  private requestTimestamps: number[] = [];
  private lastRateLimitLogKey: string | null = null;
  private nextRequestAt = 0;

  constructor(
    private readonly token: string | undefined | (() => Promise<string | undefined>),
    private readonly options: GitHubClientOptions = {}
  ) {}

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const response = await this.request<T>("GET", path, undefined, params);
    return response.data as T;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request<T>("POST", path, JSON.stringify(body));
    return response.data as T;
  }

  async getText(path: string, accept = "text/plain", params?: Record<string, string | number | boolean | undefined>): Promise<string> {
    return this.requestText("GET", path, accept, undefined, params);
  }

  async getConditional<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    validators?: { etag?: string | null; lastModified?: string | null }
  ): Promise<{ status: 200 | 304; data: T | null; etag: string | null; lastModified: string | null; headers: Headers }> {
    return this.request<T>("GET", path, undefined, params, validators);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: string,
    params?: Record<string, string | number | boolean | undefined>,
    validators?: { etag?: string | null; lastModified?: string | null }
  ): Promise<{ status: 200 | 304; data: T | null; etag: string | null; lastModified: string | null; headers: Headers }> {
    await this.throttle();
    const token = typeof this.token === "function" ? await this.token() : this.token;
    const url = this.url(path);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        "X-GitHub-Api-Version": "2022-11-28",
        ...(validators?.etag ? { "If-None-Match": validators.etag } : {}),
        ...(validators?.lastModified ? { "If-Modified-Since": validators.lastModified } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body
    });
    const responseRateLimit = rateLimitFrom(response);
    this.rememberOAuthScopes(response.headers);

    if (response.status === 304) {
      this.rememberRateLimit(responseRateLimit, responseRateLimit.remaining === 0);
      return {
        status: 304,
        data: null,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        headers: response.headers
      };
    }

    if (!response.ok) {
      const body = await response.text();
      const rateLimited = isRateLimitResponse(response.status, body, responseRateLimit);
      this.rememberRateLimit(responseRateLimit, rateLimited);
      if (rateLimited) {
        this.logRateLimit(method, url, response.status, response.statusText, body, this.getRateLimit());
      }
      throw new GitHubApiError(response.status, response.statusText, body, this.getRateLimit(), headersFrom(response.headers));
    }

    this.rememberRateLimit(responseRateLimit, responseRateLimit.remaining === 0);
    return {
      status: 200,
      data: (await response.json()) as T,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      headers: response.headers
    };
  }

  private async requestText(
    method: "GET",
    path: string,
    accept: string,
    body?: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<string> {
    await this.throttle();
    const token = typeof this.token === "function" ? await this.token() : this.token;
    const url = this.url(path);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        Accept: accept,
        ...(body ? { "Content-Type": "application/json" } : {}),
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body
    });
    const responseRateLimit = rateLimitFrom(response);
    this.rememberOAuthScopes(response.headers);
    const text = await response.text();

    if (!response.ok) {
      const rateLimited = isRateLimitResponse(response.status, text, responseRateLimit);
      this.rememberRateLimit(responseRateLimit, rateLimited);
      if (rateLimited) {
        this.logRateLimit(method, url, response.status, response.statusText, text, this.getRateLimit());
      }
      throw new GitHubApiError(response.status, response.statusText, text, this.getRateLimit(), headersFrom(response.headers));
    }

    this.rememberRateLimit(responseRateLimit, responseRateLimit.remaining === 0);
    return text;
  }

  async paginate<T>(path: string, params?: Record<string, string | number | boolean | undefined>, maxPages = 3): Promise<T[]> {
    const items: T[] = [];
    let nextPath: string | null = path;
    let nextParams: Record<string, string | number | boolean | undefined> | undefined = { ...params, per_page: 100 };
    for (let page = 1; page <= maxPages && nextPath; page += 1) {
      const response = await this.request<T[]>("GET", nextPath, undefined, nextParams);
      const pageItems = response.data ?? [];
      items.push(...pageItems);
      nextPath = githubNextLink(response.headers);
      nextParams = undefined;
    }
    return items;
  }

  private url(path: string): URL {
    if (path.startsWith("https://")) return new URL(path);
    const rawEndpoint = typeof this.options.apiEndpoint === "function" ? this.options.apiEndpoint() : this.options.apiEndpoint;
    const endpoint = (rawEndpoint ?? "https://api.github.com").replace(/\/+$/, "");
    return new URL(path, `${endpoint}/`);
  }

  getRateLimit(): GitHubRateLimit | null {
    if (this.blockedRateLimit?.resetAt && Date.parse(this.blockedRateLimit.resetAt) > Date.now()) {
      return this.blockedRateLimit;
    }
    this.blockedRateLimit = null;
    return this.rateLimit;
  }

  getOAuthScopes(): string[] | null {
    return this.oauthScopes;
  }

  private rememberRateLimit(rateLimit: GitHubRateLimit, blocked: boolean): void {
    if (blocked) {
      this.blockedRateLimit = this.blocked(rateLimit);
      this.rateLimit = this.blockedRateLimit;
      return;
    }

    if (this.blockedRateLimit?.resetAt && Date.parse(this.blockedRateLimit.resetAt) > Date.now()) {
      return;
    }

    this.blockedRateLimit = null;
    this.rateLimit = rateLimit;
  }

  private rememberOAuthScopes(headers: Headers): void {
    const scopes = headers.get("x-oauth-scopes");
    if (scopes == null) return;
    this.oauthScopes = scopes
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
  }

  private async throttle(): Promise<void> {
    const run = this.requestChain.then(
      () => this.reserveRequest(),
      () => this.reserveRequest()
    );
    this.requestChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async reserveRequest(): Promise<void> {
    const blocked = this.getRateLimit();
    if (blocked?.remaining === 0 && blocked.resetAt && Date.parse(blocked.resetAt) > Date.now()) {
      const message = "Fallback is using cached GitHub data until the rate limit resets.";
      this.logRateLimit("GET", null, 429, "Too Many Requests", message, blocked);
      throw new GitHubApiError(429, "Too Many Requests", message, blocked, {});
    }

    const budgetWindowMs = this.options.budgetWindowMs ?? 60 * 60_000;
    const hourlyRequestBudget = this.options.hourlyRequestBudget ?? Number.POSITIVE_INFINITY;
    const now = Date.now();
    const windowStart = now - budgetWindowMs;
    this.requestTimestamps = this.requestTimestamps.filter((timestamp) => timestamp > windowStart);

    if (this.requestTimestamps.length >= hourlyRequestBudget) {
      const resetAt = new Date(this.requestTimestamps[0]! + budgetWindowMs).toISOString();
      const rateLimit = { remaining: 0, resetAt };
      this.blockedRateLimit = rateLimit;
      this.rateLimit = rateLimit;
      const message = "Fallback local GitHub API budget reached. Cached data is still available.";
      this.logRateLimit("GET", null, 429, "Too Many Requests", message, rateLimit);
      throw new GitHubApiError(429, "Too Many Requests", message, rateLimit, {});
    }

    const waitMs = Math.max(0, this.nextRequestAt - now);
    if (waitMs > 0) {
      await delay(waitMs);
    }

    const reservedAt = Date.now();
    this.requestTimestamps.push(reservedAt);
    this.nextRequestAt = reservedAt + (this.options.minRequestIntervalMs ?? 0);
  }

  private blocked(rateLimit: GitHubRateLimit): GitHubRateLimit {
    return {
      ...rateLimit,
      remaining: 0,
      resetAt: rateLimit.resetAt ?? new Date(Date.now() + (this.options.defaultBlockMs ?? 60_000)).toISOString()
    };
  }

  private logRateLimit(
    method: string,
    url: URL | null,
    status: number,
    statusText: string,
    body: string,
    rateLimit: GitHubRateLimit | null
  ): void {
    const message = githubErrorMessage(body);
    const requestId = githubRequestId(body);
    const reset = rateLimit?.resetAt ? new Date(rateLimit.resetAt).toLocaleString() : "unknown";
    const pathname = url ? `${url.pathname}${url.search ? "?..." : ""}` : "local-throttle";
    const logKey = `${status}:${pathname}:${rateLimit?.resetAt ?? ""}:${message}:${requestId ?? ""}`;
    if (this.lastRateLimitLogKey === logKey) return;
    this.lastRateLimitLogKey = logKey;
    console.warn(
      `[github:rate-limit] ${method} ${pathname} -> ${status} ${statusText}; remaining=${rateLimit?.remaining ?? "unknown"} reset=${reset}; message="${message}"${
        requestId ? ` request_id=${requestId}` : ""
      }`
    );
  }
}

export interface GitHubClientOptions {
  apiEndpoint?: string | (() => string);
  minRequestIntervalMs?: number;
  hourlyRequestBudget?: number;
  budgetWindowMs?: number;
  defaultBlockMs?: number;
}

export class GitHubApiError extends Error {
  readonly body: string;
  readonly bodyTruncated: boolean;

  constructor(
    readonly status: number,
    readonly statusText: string,
    body: string,
    readonly rateLimit: GitHubRateLimit | null = null,
    readonly headers: Record<string, string> = {}
  ) {
    const bodyPreview = truncateGitHubErrorBody(body);
    super(`GitHub API ${status} ${statusText}: ${bodyPreview.slice(0, 240)}`);
    this.body = bodyPreview;
    this.bodyTruncated = bodyPreview.length !== body.length;
  }
}

function truncateGitHubErrorBody(body: string): string {
  const maxBodyLength = 2_048;
  if (body.length <= maxBodyLength) return body;
  return `${body.slice(0, maxBodyLength)}\n... [truncated ${body.length - maxBodyLength} chars]`;
}

export interface GitHubRateLimit {
  remaining: number | null;
  resetAt: string | null;
}

function rateLimitFrom(response: Response): GitHubRateLimit {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  return {
    remaining: remaining == null ? null : Number(remaining),
    resetAt: reset == null ? null : new Date(Number(reset) * 1000).toISOString()
  };
}

function headersFrom(headers: Headers): Record<string, string> {
  const values: Record<string, string> = {};
  headers.forEach((value, key) => {
    values[key.toLowerCase()] = value;
  });
  return values;
}

export function githubNextLink(headers: Headers): string | null {
  const link = headers.get("link");
  if (!link) return null;
  for (const part of link.split(",")) {
    const match = /^\s*<([^>]+)>;\s*rel="([^"]+)"\s*$/.exec(part);
    if (match?.[2] === "next") return match[1] ?? null;
  }
  return null;
}

function isRateLimitResponse(status: number, body: string, rateLimit: GitHubRateLimit): boolean {
  return status === 429 || rateLimit.remaining === 0 || /rate limit/i.test(body);
}

function githubErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // fall through to raw body
  }
  return body.replaceAll(/\s+/g, " ").trim().slice(0, 300) || "GitHub rate limit reached";
}

function githubRequestId(body: string): string | null {
  return /request ID\s+([A-Z0-9:]+)/i.exec(body)?.[1] ?? null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GitHubRepo {
  id: number;
  owner: { login: string; avatar_url?: string | null };
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived?: boolean;
  has_issues?: boolean;
  is_template?: boolean;
  language?: string | null;
  default_branch: string | null;
  html_url: string | null;
  clone_url: string | null;
  ssh_url: string | null;
  visibility: string | null;
  stargazers_count?: number;
  forks_count?: number;
  subscribers_count?: number;
  size?: number;
  license?: { spdx_id: string | null; name: string | null } | null;
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean } | null;
  pushed_at: string | null;
  updated_at: string | null;
}

export interface GitHubContentItem {
  name: string;
  path: string;
  sha: string | null;
  size: number | null;
  type: "file" | "dir" | "symlink" | "submodule";
  html_url: string | null;
  download_url: string | null;
  content?: string | null;
  encoding?: string | null;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string; url: string | null };
  protected: boolean;
}

export interface GitHubNamedRef {
  name: string;
  commit?: { sha: string; url: string | null };
  tarball_url?: string | null;
  zipball_url?: string | null;
}

export interface GitHubRelease {
  id: number;
  name: string | null;
  tag_name: string;
  html_url: string | null;
  draft: boolean;
  prerelease: boolean;
  created_at: string | null;
  published_at: string | null;
  body: string | null;
  tarball_url?: string | null;
  zipball_url?: string | null;
  author?: {
    login: string;
    avatar_url: string | null;
    html_url: string | null;
  } | null;
}

export interface GitHubContributor {
  login: string;
  avatar_url: string | null;
  html_url: string | null;
  contributions: number;
}

export interface GitHubCommit {
  sha: string;
  html_url: string | null;
  author: { login: string } | null;
  commit: {
    message: string;
    author: { name: string | null; date: string | null } | null;
    committer: { name: string | null; date: string | null } | null;
    verification?: { verified?: boolean };
  };
}

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string | null;
  html_url?: string | null;
  name?: string | null;
  type?: string | null;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  user: { login: string } | null;
  assignees?: Array<{ login: string }>;
  requested_reviewers?: Array<{ login: string }>;
  state: string;
  draft?: boolean;
  locked?: boolean;
  merged?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string | null;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  additions?: number;
  deletions?: number;
  changed_files?: number;
  comments?: number;
  review_comments?: number;
  commits?: number;
  html_url: string | null;
  diff_url: string | null;
  patch_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  merged_at: string | null;
  labels?: GitHubLabel[];
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  user: { login: string } | null;
  assignees?: Array<{ login: string }>;
  state: string;
  type?: { id?: number; name?: string | null; node_id?: string | null } | null;
  locked?: boolean;
  comments?: number;
  html_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  pull_request?: unknown;
  labels?: GitHubLabel[];
}

export interface GitHubIssueType {
  id: number;
  name: string;
  description?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface GitHubIssueField {
  id: number;
  name: string;
  description?: string | null;
  data_type?: string | null;
  options?: Array<{ id?: number; name: string; color?: string | null; description?: string | null }>;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface GitHubComment {
  id: number;
  user: { login: string } | null;
  body: string | null;
  html_url: string | null;
  path?: string | null;
  position?: number | null;
  original_position?: number | null;
  commit_id?: string | null;
  original_commit_id?: string | null;
  diff_hunk?: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface GitHubReview {
  id: number;
  user: { login: string } | null;
  state: string;
  body: string | null;
  html_url: string | null;
  commit_id: string | null;
  submitted_at: string | null;
}

export interface GitHubLabel {
  id: number;
  name: string;
  color: string | null;
  description: string | null;
}

export interface GitHubCheckRun {
  id: number;
  name: string;
  status: string | null;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string | null;
  details_url: string | null;
}

export interface GitHubCheckRunsResponse {
  total_count: number;
  check_runs: GitHubCheckRun[];
}

export interface GitHubCommitStatus {
  id: number;
  context: string;
  state: string;
  description: string | null;
  target_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string | null;
  display_title?: string | null;
  run_number?: number | null;
  run_attempt?: number | null;
  event?: string | null;
  status: string | null;
  conclusion: string | null;
  head_branch: string | null;
  head_sha: string | null;
  html_url: string | null;
  actor?: { login?: string | null } | null;
  path?: string | null;
  run_started_at?: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface GitHubWorkflowRunsResponse {
  total_count: number;
  workflow_runs: GitHubWorkflowRun[];
}

export interface GitHubPullRequestCommit {
  sha: string;
  commit?: {
    message?: string | null;
    tree?: { sha?: string | null } | null;
    author?: { date?: string | null } | null;
    committer?: { date?: string | null } | null;
  } | null;
}

export interface GitHubCompareResponse {
  status?: string | null;
  ahead_by?: number | null;
  behind_by?: number | null;
  total_commits?: number | null;
  files?: Array<{ additions?: number | null; deletions?: number | null; changes?: number | null }> | null;
}

export interface GitHubCreatedPullRequest {
  number: number;
  html_url: string | null;
  head?: { ref?: string | null } | null;
  base?: { ref?: string | null } | null;
}
