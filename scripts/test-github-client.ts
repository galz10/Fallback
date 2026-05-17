import assert from "node:assert/strict";
import { GitHubApiError, GitHubClient } from "../electron/main/github-client.js";

const originalFetch = globalThis.fetch;

try {
  await testPaginationAndRateLimit();
  await testCursorPagination();
  await testRateLimitError();
  await testOAuthScopes();
  await testRateLimitBlockPersistsPastRateLimitEndpoint();
  await testLocalBudgetStopsBeforeFetch();
  testGitHubApiErrorTruncatesLargeBodies();
  console.log("GitHub client mocked sync tests ok");
} finally {
  globalThis.fetch = originalFetch;
}

async function testPaginationAndRateLimit(): Promise<void> {
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    const page = new URL(url).searchParams.get("page") ?? "1";
    const body = page === "1" ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 101 }];
    return jsonResponse(body, {
      "x-ratelimit-remaining": "42",
      "x-ratelimit-reset": "1893456000",
      ...(page === "1" ? { link: '<https://api.github.com/repos/octo/repo/issues?state=open&per_page=100&page=2>; rel="next"' } : {})
    });
  };

  const client = new GitHubClient("token");
  const rows = await client.paginate<{ id: number }>("/repos/octo/repo/issues", { state: "open" }, 3);

  assert.equal(rows.length, 101);
  assert.equal(requested.length, 2);
  assert.equal(new URL(requested[0]!).searchParams.get("per_page"), "100");
  assert.equal(new URL(requested[0]!).searchParams.has("page"), false);
  assert.equal(new URL(requested[1]!).searchParams.get("page"), "2");
  assert.deepEqual(client.getRateLimit(), { remaining: 42, resetAt: "2030-01-01T00:00:00.000Z" });
}

async function testCursorPagination(): Promise<void> {
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    const after = new URL(url).searchParams.get("after");
    const body = after ? [{ id: 2 }] : [{ id: 1 }];
    return jsonResponse(body, {
      ...(after ? {} : { link: '<https://api.github.com/repos/octo/repo/issues?state=open&per_page=100&after=cursor-1>; rel="next"' })
    });
  };

  const client = new GitHubClient("token");
  const rows = await client.paginate<{ id: number }>("/repos/octo/repo/issues", { state: "open" }, 3);

  assert.deepEqual(
    rows.map((row) => row.id),
    [1, 2]
  );
  assert.equal(new URL(requested[0]!).searchParams.has("page"), false);
  assert.equal(new URL(requested[1]!).searchParams.get("after"), "cursor-1");
}

async function testRateLimitError(): Promise<void> {
  globalThis.fetch = async () =>
    new Response("rate limit exceeded", {
      status: 403,
      statusText: "Forbidden",
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1893456000" }
    });

  const client = new GitHubClient("token");
  await assert.rejects(client.get("/user"), (error) => {
    assert.ok(error instanceof GitHubApiError);
    assert.equal(error.status, 403);
    assert.deepEqual(error.rateLimit, { remaining: 0, resetAt: "2030-01-01T00:00:00.000Z" });
    assert.deepEqual(client.getRateLimit(), error.rateLimit);
    return true;
  });
}

async function testOAuthScopes(): Promise<void> {
  globalThis.fetch = async () => jsonResponse({ id: 1 }, { "x-oauth-scopes": "repo, read:user, read:org" });

  const client = new GitHubClient("token");
  await client.get("/user");
  assert.deepEqual(client.getOAuthScopes(), ["repo", "read:user", "read:org"]);
}

async function testRateLimitBlockPersistsPastRateLimitEndpoint(): Promise<void> {
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call === 1) {
      return new Response("API rate limit exceeded", {
        status: 403,
        statusText: "Forbidden",
        headers: {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-used": "5000",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1893456000"
        }
      });
    }
    return jsonResponse(
      { rate: { limit: 5000, used: 1, remaining: 4999, reset: 1893456000 } },
      { "x-ratelimit-limit": "5000", "x-ratelimit-used": "1", "x-ratelimit-remaining": "4999", "x-ratelimit-reset": "1893456000" }
    );
  };

  const client = new GitHubClient("token");
  await assert.rejects(client.get("/user"), GitHubApiError);
  assert.deepEqual(client.getRateLimit(), { remaining: 0, resetAt: "2030-01-01T00:00:00.000Z" });

  await assert.rejects(client.get("/rate_limit"), GitHubApiError);
  assert.equal(call, 1);
  assert.deepEqual(client.getRateLimit(), { remaining: 0, resetAt: "2030-01-01T00:00:00.000Z" });
}

async function testLocalBudgetStopsBeforeFetch(): Promise<void> {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ ok: true }, { "x-ratelimit-remaining": "42", "x-ratelimit-reset": "1893456000" });
  };

  const client = new GitHubClient("token", { hourlyRequestBudget: 1, budgetWindowMs: 60_000 });
  await client.get("/user");
  await assert.rejects(client.get("/user"), (error) => {
    assert.ok(error instanceof GitHubApiError);
    assert.equal(error.status, 429);
    assert.equal(error.rateLimit?.remaining, 0);
    return true;
  });
  assert.equal(calls, 1);
}

function testGitHubApiErrorTruncatesLargeBodies(): void {
  const error = new GitHubApiError(504, "Gateway Timeout", `<html>${"x".repeat(50_000)}</html>`);
  assert.ok(error.body.length < 3_000);
  assert.equal(error.bodyTruncated, true);
  assert.ok(!error.stack?.includes("xxxxx".repeat(1_000)));
}

function jsonResponse(body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
}
