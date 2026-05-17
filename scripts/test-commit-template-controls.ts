import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommitTemplateControls } from "../src/renderer/components/CommitTemplateControls.js";
import { commitDraftFromTemplate, commitTemplateContext } from "../src/shared/commit-templates.js";
import type { CommitTemplate } from "../src/shared/domain/local-git.js";

const templates: CommitTemplate[] = [
  {
    id: "git:/tmp/repo/.gitmessage",
    name: "Git commit.template",
    source: "git",
    scope: "repo",
    path: "/tmp/repo/.gitmessage",
    repoId: null,
    body: "{ticket}: {summary}\n\nRepo: {repo}"
  },
  {
    id: "repo-template",
    name: "Repo default",
    source: "fallback",
    scope: "repo",
    path: null,
    repoId: "octo-repo",
    body: "chore: {summary}"
  }
];

const html = renderToStaticMarkup(
  React.createElement(CommitTemplateControls, {
    templates,
    selectedTemplateId: templates[0]!.id,
    templateName: "Repo default",
    canApply: true,
    canSave: true,
    onSelectedTemplateIdChange: () => undefined,
    onTemplateNameChange: () => undefined,
    onApply: () => undefined,
    onSave: () => undefined
  })
);

assert.match(html, /Commit template/);
assert.match(html, /Git template/);
assert.match(html, /Repo default/);
assert.match(html, /Apply template/);
assert.match(html, /Save repo template/);

const draft = commitDraftFromTemplate(
  templates[0]!,
  commitTemplateContext({
    summary: "add controls",
    branch: "feature/FB-456-controls",
    repoFullName: "octo/repo",
    identity: null
  })
);
assert.equal(draft.summary, "FB-456: add controls");
assert.equal(draft.description, "Repo: octo/repo");

console.log("Commit template controls tests ok");
