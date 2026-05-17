import type React from "react";
import type { GitHubRepoSummary, WatchedRepo } from "../../../shared/domain/watched-repo";
import type { CommitSearchHit, RepoFileEntry } from "../../../shared/domain/repo-code";
import type { LocalChangesSummary } from "../../../shared/domain/local-git";
import type { OperationRecord } from "../../../shared/domain/operation";
import type { SearchResult, TimelineComment } from "../../../shared/domain/github-work";

export type CommandPaletteItemKind = "action" | "submenu" | "repo" | "file" | "commit" | "pull_request" | "issue" | "operation";

export type CommandPaletteViewId = "root" | "add-repo" | "open" | "sync" | "local-changes";

export type CommandPaletteMode = "root" | "action" | "repo-picker" | "commit";

export type CommandPalettePayload =
  | { type: "repo"; repo: WatchedRepo }
  | { type: "available-repo"; repo: GitHubRepoSummary }
  | { type: "manual-repo"; fullName: string }
  | { type: "file"; repo: WatchedRepo; file: RepoFileEntry }
  | { type: "commit"; commit: CommitSearchHit }
  | { type: "result"; result: SearchResult }
  | { type: "operation"; operation: OperationRecord }
  | { type: "comment"; comment: TimelineComment; repo: WatchedRepo }
  | { type: "local-changes"; summary: LocalChangesSummary; repo: WatchedRepo };

export interface CommandPaletteItem {
  kind: CommandPaletteItemKind;
  value: string;
  searchTerms: string[];
  title: string;
  description?: string;
  timestamp?: string | null;
  shortcut?: string[];
  disabled?: string | boolean;
  keepOpen?: boolean;
  leadingContent?: React.ReactNode;
  trailingContent?: React.ReactNode;
  payload?: CommandPalettePayload;
  run?: () => void | Promise<void>;
}

export interface CommandPaletteGroup {
  value: string;
  label: string;
  items: CommandPaletteItem[];
}

export interface PaletteGroupFilter {
  id: string;
  name: string;
}
