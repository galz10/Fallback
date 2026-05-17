import type { FallbackCommitTemplate } from "./domain/settings.js";
import type { RepoIdentity } from "./domain/repo-identity.js";
import type { CommitTemplate } from "./domain/local-git.js";

export interface CommitTemplateContext {
  summary: string;
  branch: string;
  ticket: string;
  repo: string;
  author: string;
}

export interface CommitTemplateDraft {
  summary: string;
  description: string;
}

export const conventionalCommitTemplate: CommitTemplate = {
  id: "builtin:conventional",
  name: "Conventional commit",
  source: "builtin",
  scope: "global",
  path: null,
  repoId: null,
  body: "feat: {summary}\n\n{ticket}"
};

const variablePattern = /\{(summary|branch|ticket|repo|author)\}/g;

export function interpolateCommitTemplate(body: string, context: CommitTemplateContext): string {
  return body.replace(variablePattern, (_match, key: keyof CommitTemplateContext) => context[key] ?? "");
}

export function commitDraftFromTemplate(template: Pick<CommitTemplate, "body">, context: CommitTemplateContext): CommitTemplateDraft {
  const interpolated = stripGitTemplateComments(interpolateCommitTemplate(template.body, context)).trim();
  if (!interpolated) return { summary: "", description: "" };
  const [summaryLine, ...descriptionLines] = interpolated.split(/\r?\n/);
  return {
    summary: summaryLine.trim(),
    description: descriptionLines.join("\n").trim()
  };
}

export function commitTemplateBody(summary: string, description: string): string {
  return [summary.trim(), description.trim()].filter(Boolean).join("\n\n");
}

export function commitTemplateContext(input: {
  summary: string;
  branch: string | null | undefined;
  repoFullName: string;
  identity?: RepoIdentity | null;
}): CommitTemplateContext {
  const branch = input.branch || "HEAD";
  return {
    summary: input.summary.trim(),
    branch,
    ticket: ticketFromBranch(branch),
    repo: input.repoFullName,
    author: commitTemplateAuthor(input.identity)
  };
}

export function fallbackTemplatesForRepo(settings: { commitTemplates?: FallbackCommitTemplate[] }, repoId: string): CommitTemplate[] {
  return (settings.commitTemplates ?? [])
    .filter((template) => template.repoId === null || template.repoId === repoId)
    .map((template) => ({
      id: template.id,
      name: template.name,
      body: template.body,
      source: "fallback" as const,
      scope: template.repoId ? ("repo" as const) : ("global" as const),
      path: null,
      repoId: template.repoId
    }));
}

export function normalizeCommitTemplates(value: unknown): FallbackCommitTemplate[] {
  if (!Array.isArray(value)) return [];
  const templates: FallbackCommitTemplate[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = stringValue(record.id);
    const name = stringValue(record.name);
    const body = stringValue(record.body);
    if (!id || !name || !body) continue;
    templates.push({
      id,
      name,
      body,
      repoId: typeof record.repoId === "string" ? record.repoId : null,
      createdAt: stringValue(record.createdAt) || new Date(0).toISOString(),
      updatedAt: stringValue(record.updatedAt) || stringValue(record.createdAt) || new Date(0).toISOString()
    });
  }
  return templates;
}

export function upsertCommitTemplate(
  templates: FallbackCommitTemplate[],
  template: Omit<FallbackCommitTemplate, "createdAt" | "updatedAt"> & Partial<Pick<FallbackCommitTemplate, "createdAt" | "updatedAt">>,
  now = new Date().toISOString()
): FallbackCommitTemplate[] {
  const next: FallbackCommitTemplate = {
    ...template,
    createdAt: template.createdAt ?? now,
    updatedAt: now
  };
  const existingIndex = templates.findIndex((item) => item.id === template.id);
  if (existingIndex < 0) return [...templates, next];
  return templates.map((item, index) => (index === existingIndex ? { ...next, createdAt: item.createdAt } : item));
}

function stripGitTemplateComments(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function ticketFromBranch(branch: string): string {
  const match = branch.match(/[A-Z][A-Z0-9]+-\d+/i);
  return match ? match[0].toUpperCase() : "";
}

function commitTemplateAuthor(identity?: RepoIdentity | null): string {
  const name = identity?.gitName ?? identity?.currentGitName ?? "";
  const email = identity?.gitEmail ?? identity?.currentGitEmail ?? "";
  if (name && email) return `${name} <${email}>`;
  return name || email;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
