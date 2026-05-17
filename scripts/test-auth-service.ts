import assert from "node:assert/strict";
import type { TokenService } from "../electron/main/token-service.js";

process.env.GITHUB_CLIENT_ID = "client-id";

const { AuthService, buildGitHubBrowserOAuthAuthorizationUrl, parseGitHubBrowserOAuthCallback } =
  await import("../electron/main/auth-service.js");
const { GitHubClient } = await import("../electron/main/github-client.js");
const originalFetch = globalThis.fetch;
let storedToken: string | undefined;
let deviceTokenAttempts = 0;

try {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://github.com/login/device/code") {
      assert.equal((init?.body as URLSearchParams).get("client_id"), "client-id");
      return jsonResponse({
        device_code: "device-code",
        user_code: "ABCD-EFGH",
        verification_uri: "https://github.com/login/device",
        verification_uri_complete: "https://github.com/login/device?user_code=ABCD-EFGH",
        expires_in: 900,
        interval: 5
      });
    }
    if (url === "https://github.com/login/oauth/access_token") {
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("client_id"), "client-id");
      if (body.get("device_code")) {
        assert.equal(body.get("device_code"), "device-code");
        deviceTokenAttempts += 1;
        if (deviceTokenAttempts === 1) return jsonResponse({ error: "authorization_pending" });
        return jsonResponse({ access_token: "oauth-token" });
      }
      assert.equal(body.get("code"), "browser-code");
      assert.equal(body.get("redirect_uri"), "fallback://oauth");
      return jsonResponse({ access_token: "browser-token" });
    }
    if (url === "https://api.github.com/user")
      return jsonResponse({ id: 1, login: "mona", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" });
    throw new Error(`Unexpected fetch ${url}`);
  };

  const auth = new AuthService(
    {
      getSource: async () => (storedToken ? "keychain" : null),
      setToken: async (token: string) => {
        storedToken = token;
      },
      deleteToken: async () => {
        storedToken = undefined;
      }
    } as unknown as TokenService,
    new GitHubClient(async () => storedToken)
  );

  const flow = await auth.startGitHubOAuth();
  assert.equal(flow.deviceCode, "device-code");
  assert.equal(flow.userCode, "ABCD-EFGH");
  assert.equal(flow.verificationUri, "https://github.com/login/device");
  assert.equal(flow.verificationUriComplete, "https://github.com/login/device?user_code=ABCD-EFGH");

  const pending = await auth.completeGitHubOAuth(flow.deviceCode);
  assert.equal(pending.status, "pending");
  const completed = await auth.completeGitHubOAuth(flow.deviceCode);
  assert.equal(completed.status, "success");
  assert.equal(storedToken, "oauth-token");
  const authState = await auth.getAuthState();
  assert.equal(authState.status, "connected");
  assert.equal(authState.source, "keychain");
  assert.equal(authState.login, "mona");
  assert.equal(authState.avatarUrl, "https://avatars.githubusercontent.com/u/1?v=4");
  assert.equal(authState.endpoint, "https://api.github.com");
  assert.deepEqual(authState.tokenScopes, ["repo", "read:user", "read:org"]);

  const authorizationUrl = buildGitHubBrowserOAuthAuthorizationUrl({
    clientId: "client-id",
    redirectUri: "fallback://oauth",
    scopes: ["repo", "read:user", "read:org"],
    state: "state-123"
  });
  const authorization = new URL(authorizationUrl);
  assert.equal(authorization.origin, "https://github.com");
  assert.equal(authorization.pathname, "/login/oauth/authorize");
  assert.equal(authorization.searchParams.get("client_id"), "client-id");
  assert.equal(authorization.searchParams.get("redirect_uri"), "fallback://oauth");
  assert.equal(authorization.searchParams.get("scope"), "repo read:user read:org");
  assert.equal(authorization.searchParams.get("state"), "state-123");

  assert.deepEqual(parseGitHubBrowserOAuthCallback("fallback://oauth?code=code-1&state=state-1"), {
    code: "code-1",
    state: "state-1",
    error: null,
    errorDescription: null
  });
  assert.deepEqual(parseGitHubBrowserOAuthCallback("fallback://oauth?error=access_denied&error_description=Nope&state=state-1"), {
    code: null,
    state: "state-1",
    error: "access_denied",
    errorDescription: "Nope"
  });
  assert.equal(parseGitHubBrowserOAuthCallback("fallback://oauth?state=state-1").code, null);
  assert.equal(parseGitHubBrowserOAuthCallback("fallback://oauth?code=code-1").state, null);
  assert.throws(() => parseGitHubBrowserOAuthCallback("https://fallback.local/oauth?code=code-1"));

  const browserFlow = await auth.startGitHubBrowserOAuth();
  const browserAuthorization = new URL(browserFlow.authorizationUrl);
  assert.equal(browserAuthorization.searchParams.get("client_id"), "client-id");
  assert.equal(browserAuthorization.searchParams.get("redirect_uri"), "fallback://oauth");
  assert.equal(browserAuthorization.searchParams.get("scope"), "repo read:user read:org");
  assert.equal(browserAuthorization.searchParams.get("state"), browserFlow.state);
  await assert.rejects(
    () => auth.completeGitHubBrowserOAuth("fallback://oauth?code=browser-code&state=wrong-state"),
    /state did not match/
  );
  await assert.rejects(() => auth.completeGitHubBrowserOAuth(`fallback://oauth?state=${browserFlow.state}`), /did not include a code/);
  const retryBrowserFlow = await auth.startGitHubBrowserOAuth();
  await auth.completeGitHubBrowserOAuth(`fallback://oauth?code=browser-code&state=${retryBrowserFlow.state}`);
  assert.equal(storedToken, "browser-token");
  await assert.rejects(
    () => auth.completeGitHubBrowserOAuth(`fallback://oauth?code=browser-code&state=${retryBrowserFlow.state}`),
    /No GitHub browser sign-in/
  );

  console.log("Auth service OAuth tests ok");
} finally {
  globalThis.fetch = originalFetch;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
