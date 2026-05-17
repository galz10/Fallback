import React from "react";
import { ChevronDown } from "lucide-react";
import { AlertIcon as GitHubAlertIcon, FileIcon as GitHubFileIcon } from "@primer/octicons-react";
import type { WatchedRepo } from "../../../shared/domain/watched-repo";
import type { RepoFileContent, RepoFileEntry } from "../../../shared/domain/repo-code";
import { Button as UiButton, EmptyState, Surface } from "../../components/ui";
import { Collapsible, CollapsibleContent } from "../../components/ui/collapsible";
import { MarkdownBody } from "../github-work/MarkdownBody";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ReadmePanel({
  repo,
  readmeFile,
  readme,
  isFetching,
  error,
  collapsed,
  onCollapsedChange
}: {
  repo: WatchedRepo;
  readmeFile: RepoFileEntry;
  readme?: RepoFileContent;
  isFetching: boolean;
  error: unknown;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const readmeContents = readme && !readme.isBinary ? readme.contents : null;
  const hasPreview = Boolean(readmeContents);

  return (
    <Collapsible open={!collapsed} onOpenChange={(open) => onCollapsedChange(!open)}>
      <Surface className="repo-readme-panel overflow-hidden">
        <div className="repo-readme-header flex items-center justify-between gap-3 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-neutral-800 bg-neutral-950 text-neutral-500">
              <GitHubFileIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium leading-5 text-neutral-200">README</div>
              <div className="truncate font-mono text-[11px] leading-4 text-neutral-600">{readmeFile.path}</div>
            </div>
          </div>
          <UiButton
            aria-expanded={!collapsed}
            aria-controls="repo-readme-panel"
            onClick={() => onCollapsedChange(!collapsed)}
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-neutral-400 hover:text-neutral-100"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
            <span>{collapsed ? "Show" : "Hide"}</span>
          </UiButton>
        </div>
        <CollapsibleContent id="repo-readme-panel">
          <div className="repo-readme-content max-h-[560px] overflow-y-auto px-6 py-6">
            {isFetching && !readme && <EmptyState title="Loading README..." />}
            {Boolean(error) && (
              <div className="flex items-center gap-2 text-sm text-red-900">
                <GitHubAlertIcon className="h-4 w-4" />
                <span>{errorMessage(error)}</span>
              </div>
            )}
            {!isFetching && !error && !hasPreview && (
              <EmptyState
                title="README preview unavailable."
                detail={readme?.isTooLarge ? "The cached README is too large to preview." : "The cached README is empty or binary."}
              />
            )}
            {hasPreview && <MarkdownBody value={readmeContents} repoUrl={repo.htmlUrl} className="repo-readme-body" />}
          </div>
        </CollapsibleContent>
      </Surface>
    </Collapsible>
  );
}
