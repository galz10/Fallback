import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShellIcon } from "../src/renderer/components/ShellIcon.js";
import { connectivityRecoveryProbeIntervalMs, isRecoverableGitHubConnectivityState } from "../src/renderer/shell/connectivity-recovery.js";

assert.equal(connectivityRecoveryProbeIntervalMs, 10_000);

for (const state of ["offline", "github_down", "github_degraded", "unknown_error"] as const) {
  assert.equal(isRecoverableGitHubConnectivityState(state), true, `${state} should retry GitHub recovery probes`);
}

for (const state of ["online", "auth_error", "rate_limited", "repo_access_revoked"] as const) {
  assert.equal(isRecoverableGitHubConnectivityState(state), false, `${state} should not retry GitHub recovery probes`);
}

const airplane = renderToStaticMarkup(React.createElement(ShellIcon, { name: "airplane" }));
assert.match(airplane, /17\.8 19\.2/);
assert.doesNotMatch(airplane, /3 21l5-9-5-9/);

const queue = renderToStaticMarkup(React.createElement(ShellIcon, { name: "queue" }));
assert.match(queue, /M4 6h12/);
assert.match(queue, /M17 14l4 4-4 4/);

console.log("Connectivity recovery UI tests ok");
