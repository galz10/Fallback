import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { CommitSigningStatePanel } from "../src/renderer/features/repo-identity/RepoIdentityControl.js";
import type { RepoIdentity } from "../src/shared/domain/repo-identity.js";

const missingKeyHtml = renderPanel(
  identity({
    signingMode: "ssh",
    currentSigningMode: "ssh",
    currentSigningKeyHint: null,
    signingHealth: "missing_key",
    signingHealthMessage: "SSH signing key not configured. The configured key file is missing (id_ed25519.pub)."
  })
);
assert.match(missingKeyHtml, /failed/);
assert.match(missingKeyHtml, /SSH signing key not configured/);

const keyPresentHtml = renderPanel(
  identity({
    signingMode: "ssh",
    signingKeyHint: "~/.ssh/id_ed25519.pub",
    currentSigningMode: "ssh",
    currentSigningKeyHint: "id_ed25519.pub",
    signingHealth: "configured",
    signingHealthMessage: "SSH commit signing is configured."
  })
);
assert.match(keyPresentHtml, /signed/);
assert.match(keyPresentHtml, /id_ed25519\.pub/);

const source = readFileSync(new URL("../src/renderer/features/repo-identity/RepoIdentityControl.tsx", import.meta.url), "utf8");
assert.match(source, /Needs setup/);
assert.match(source, /Ready/);
assert.match(source, /SigningMeta/);
assert.match(source, /Existing keys/);
assert.match(source, /Verify/);
assert.match(source, /verification\.summary/);

const readinessSource = readFileSync(new URL("../electron/main/signing-readiness-service.ts", import.meta.url), "utf8");
assert.match(readinessSource, /GitHub signing key not uploaded\./);
assert.match(readinessSource, /GET \/user\/ssh_signing_keys/);

const signingSource = readFileSync(new URL("../electron/main/signing-config.ts", import.meta.url), "utf8");
assert.match(signingSource, /pinentry unavailable\./);
assert.match(signingSource, /Signing verification succeeded\./);

console.log("Signing setup UI tests ok");

function renderPanel(value: RepoIdentity): string {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(CommitSigningStatePanel, { identity: value, repoId: "repo-1", compact: false })
    )
  );
}

function identity(overrides: Partial<RepoIdentity> = {}): RepoIdentity {
  return {
    repoId: "repo-1",
    accountId: "account-1",
    accountLogin: "mona",
    accountEndpoint: "https://api.github.com",
    accountStatus: "connected",
    gitName: "Mona",
    gitEmail: "mona@example.com",
    signingMode: "unsigned",
    signingKeyHint: null,
    remoteProtocol: "https",
    verifiedEmailStatus: "ok",
    lastCheckedAt: "2026-05-03T00:00:00.000Z",
    lastCheckStatus: "ok",
    currentGitName: "Mona",
    currentGitEmail: "mona@example.com",
    currentSigningMode: "unsigned",
    currentSigningKeyHint: null,
    currentGpgProgram: null,
    currentAllowedSignersFile: null,
    signingHealth: "unsigned",
    signingHealthMessage: "Commit signing is off for this repository.",
    branch: "main",
    remoteUrl: "https://github.com/octo/repo.git",
    localPath: "/tmp/repo",
    mismatchReason: null,
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z",
    ...overrides
  };
}
