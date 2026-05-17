import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { filterWatchedRepos, sortWatchedRepos } from "../src/shared/repo-display.js";
import type { GitHubRepoSummary, WatchedRepo } from "../src/shared/domain/watched-repo.js";

const { window } = parseHTML('<!doctype html><html><body><main id="root"></main></body></html>');
globalThis.window = window as unknown as Window & typeof globalThis;
globalThis.document = window.document;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const empty = await renderMounted(React.createElement(HomeViewRendererSmoke, { repos: [], availableRepos: [], showAddPanel: false }));
assert.match(empty.html, /No repos watched yet/);
empty.unmount();

const populated = await renderMounted(
  React.createElement(HomeViewRendererSmoke, {
    repos: [
      watchedRepo("octo/api"),
      watchedRepo("octo/web", { syncStatus: "failed", openPullRequests: 2, groups: [{ id: "g1", name: "Work" }] })
    ],
    availableRepos: [],
    showAddPanel: false
  })
);
assert.match(populated.html, /data-testid="repo-display-populated"/);
assert.match(populated.html, /octo\/web/);
assert.match(populated.html, /failed/);
assert.match(populated.html, /2 PRs/);
assert.match(populated.html, /Work/);
populated.unmount();

const addPanel = await renderMounted(
  React.createElement(HomeViewRendererSmoke, {
    repos: [watchedRepo("octo/api")],
    availableRepos: [repoSummary("octo/new")],
    showAddPanel: true
  })
);
assert.match(addPanel.html, /data-testid="repo-add-panel"/);
assert.match(addPanel.html, /octo\/new/);
addPanel.unmount();

const grouped = await renderMounted(
  React.createElement(HomeViewRendererSmoke, {
    repos: [
      watchedRepo("octo/api", { groups: [{ id: "backend", name: "Backend" }] }),
      watchedRepo("octo/web", { groups: [{ id: "frontend", name: "Frontend" }] })
    ],
    availableRepos: [],
    showAddPanel: false,
    groupId: "frontend"
  })
);
assert.match(grouped.html, /octo\/web/);
assert.doesNotMatch(grouped.html, /octo\/api/);
grouped.unmount();

console.log("Mounted repository display smoke harness tests ok");

function HomeViewRendererSmoke({
  repos,
  availableRepos,
  showAddPanel,
  groupId
}: {
  repos: WatchedRepo[];
  availableRepos: GitHubRepoSummary[];
  showAddPanel: boolean;
  groupId?: string;
}) {
  if (repos.length === 0) {
    return React.createElement("section", { "data-testid": "repo-display-empty" }, "No repos watched yet");
  }

  const visible = sortWatchedRepos(filterWatchedRepos(repos, { view: "watched", groupId }), "attention");
  return React.createElement(
    "section",
    { "data-testid": "repo-display-populated" },
    visible.map((repo) =>
      React.createElement(
        "article",
        { key: repo.id },
        repo.fullName,
        " ",
        repo.syncStatus,
        " ",
        `${repo.openPullRequests} PR${repo.openPullRequests === 1 ? "" : "s"}`,
        " ",
        repo.groups.map((group) => group.name).join(",")
      )
    ),
    showAddPanel &&
      React.createElement(
        "aside",
        { "data-testid": "repo-add-panel" },
        availableRepos.map((repo) => React.createElement("button", { key: repo.id }, repo.fullName))
      )
  );
}

async function renderMounted(element: React.ReactElement): Promise<{ html: string; unmount: () => void }> {
  const container = document.createElement("section");
  document.body.append(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    html: container.innerHTML,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  };
}

function repoSummary(fullName: string): GitHubRepoSummary {
  const [owner = "octo", name = "repo"] = fullName.split("/");
  return {
    id: fullName.length,
    owner,
    name,
    fullName,
    description: null,
    ownerAvatarUrl: null,
    isPrivate: false,
    visibility: "public",
    isFork: false,
    archived: false,
    hasIssues: true,
    isTemplate: false,
    language: "TypeScript",
    permissions: null,
    defaultBranch: "main",
    htmlUrl: `https://github.com/${fullName}`,
    pushedAt: "2099-01-01T00:00:00Z",
    githubUpdatedAt: "2099-01-01T00:00:00Z",
    cloneStatus: null
  };
}

function watchedRepo(fullName: string, patch: Partial<WatchedRepo> = {}): WatchedRepo {
  const [owner = "octo", name = "repo"] = fullName.split("/");
  return {
    id: fullName.replace("/", "-"),
    githubRepoId: fullName.length,
    owner,
    name,
    fullName,
    description: null,
    ownerAvatarUrl: null,
    isPrivate: false,
    visibility: "public",
    isFork: false,
    archived: false,
    hasIssues: true,
    isTemplate: false,
    language: "TypeScript",
    permissions: null,
    defaultBranch: "main",
    htmlUrl: `https://github.com/${fullName}`,
    localPath: null,
    cloneStatus: "not_cloned",
    watchMode: "metadata-only",
    watchPriority: 0,
    syncStatus: "fresh",
    syncError: null,
    syncProgressMessage: null,
    openPullRequests: 0,
    openIssues: 0,
    pushedAt: "2099-01-01T00:00:00Z",
    githubUpdatedAt: "2099-01-01T00:00:00Z",
    lastSyncedAt: "2099-01-01T00:00:00Z",
    lastSuccessfulSyncAt: "2099-01-01T00:00:00Z",
    groups: [],
    ...patch
  };
}
