import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertIcon as GitHubAlertIcon, CommentIcon as GitHubCommentIcon } from "@primer/octicons-react";
import { SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { SubmitPullRequestReviewInput, TimelineComment } from "../../../shared/domain/github-work";
import type { OfflineAction } from "../../../shared/domain/offline-action";
import { offlineActionLabel, offlineActionPreview } from "../../../shared/domain/offline-action";
import { Avatar } from "../../components/Avatar";
import { CacheTimestamp, type CacheStampState } from "../../components/CacheTimestamp";
import { Button, Surface } from "../../components/ui";
import { Textarea } from "../../components/ui/textarea";
import { compactCount, formatRelative } from "../../lib/format";
import { IdentityRiskNotice, RepoIdentityControl } from "../repo-identity/RepoIdentityControl";
import type { EntityQueryKind } from "./work-query-language";
import { MarkdownBody } from "./MarkdownBody";

type ConversationKind = "comment" | "review-comment";
type ComposerKind = "issue" | "pull_request";
type ComposerAction = "comment" | "approve" | "request_changes";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useNetworkOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function EntityStateDot({ state, kind }: { state: string; kind: EntityQueryKind }) {
  const isOpen = state === "open";
  const colorClass =
    state === "merged" ? "border-purple-700 text-purple-900" : isOpen ? "border-green-700 text-green-900" : "border-red-700 text-red-900";

  return <span className={`h-4 w-4 shrink-0 rounded-full border grid place-items-center ${colorClass}`} title={`${kind} ${state}`} />;
}

export function isAutomatedComment(comment: TimelineComment): boolean {
  const login = comment.authorLogin?.toLowerCase() ?? "";
  return login.endsWith("[bot]") || login.includes("bot") || login === "github-actions" || login.includes("code-assist");
}

export function ConversationFilterItem<TValue extends string>({
  value,
  count,
  active,
  onSelect,
  children
}: {
  value: TValue;
  count: number;
  active: boolean;
  onSelect: (value: TValue) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(value)}
      className={`group inline-flex shrink-0 items-baseline gap-1 border-b py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <span>{children}</span>
      <span className="font-mono text-[10px] text-muted-foreground group-aria-selected:text-foreground/70">{compactCount(count)}</span>
    </button>
  );
}

export function ConversationComment({
  kind,
  comment,
  cacheState,
  cachedAt,
  repoUrl,
  compact,
  expanded,
  onToggleExpanded
}: {
  kind: ConversationKind;
  comment: TimelineComment;
  cacheState: CacheStampState;
  cachedAt: string | null;
  repoUrl?: string | null;
  compact: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const body = cleanCommentBody(comment.body);
  const shouldCollapse = body.length > 420 || body.split("\n").length > 6;
  const preview = commentPreview(body);
  const hasExpandableContent = shouldCollapse || Boolean(comment.diffHunk) || body !== preview;
  const toggleFromEvent = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    if (!hasExpandableContent) return;
    const target = event.target as HTMLElement | null;
    const interactiveTarget = target?.closest("a,button,textarea,input,select,[role='button']");
    if (interactiveTarget && interactiveTarget !== event.currentTarget) return;
    onToggleExpanded();
  };

  return (
    <article
      role={hasExpandableContent ? "button" : undefined}
      tabIndex={hasExpandableContent ? 0 : undefined}
      aria-expanded={hasExpandableContent ? expanded : undefined}
      onClick={hasExpandableContent ? toggleFromEvent : undefined}
      onKeyDown={
        hasExpandableContent
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              toggleFromEvent(event);
            }
          : undefined
      }
      className={`group rounded-lg border border-transparent bg-transparent transition-colors hover:border-border hover:bg-background-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        hasExpandableContent ? "cursor-pointer" : ""
      }`}
    >
      <div className="flex items-start gap-2.5 px-1 py-2">
        <Avatar seed={comment.authorLogin ?? "unknown"} size="sm" />
        <div className="min-w-0 flex-1 border-b border-border/70 pb-3">
          <div className="min-w-0 text-sm leading-5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-foreground">{comment.authorLogin ?? "unknown"}</span>
              {kind === "review-comment" && <GitHubCommentIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              {hasExpandableContent && (
                <span className="ml-auto shrink-0 text-[11px] font-medium text-muted-foreground opacity-80 transition-colors group-hover:text-foreground">
                  {expanded ? "Collapse" : "Expand"}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {kind === "review-comment" ? (
                <>
                  reviewed <span className="min-w-0 break-all font-mono">{comment.path ?? "a file"}</span>
                </>
              ) : (
                "commented"
              )}
              {comment.createdAt ? ` ${formatRelative(comment.createdAt)}` : ""}
              <span className="text-muted-foreground/50">·</span>
              <CacheTimestamp cachedAt={cachedAt} state={cacheState} />
            </div>
          </div>
          {compact ? (
            <div className="mt-2 min-w-0 text-sm leading-5 text-muted-foreground transition-colors group-hover:text-foreground">
              <span className="line-clamp-3 break-words [overflow-wrap:anywhere]">{preview || "No comment body."}</span>
              {hasExpandableContent && <span className="mt-1 block text-xs font-medium text-foreground/70">More in this comment</span>}
            </div>
          ) : (
            <div className="relative mt-2">
              {kind === "review-comment" && comment.diffHunk && <ReviewHunkPreview diffHunk={comment.diffHunk} />}
              <div className={shouldCollapse && !expanded ? "max-h-72 overflow-hidden" : undefined}>
                <MarkdownBody value={body} repoUrl={repoUrl} />
              </div>
              {shouldCollapse && !expanded && (
                <div className="pointer-events-none absolute inset-x-0 bottom-10 h-20 bg-gradient-to-b from-transparent to-background-100" />
              )}
              <button
                type="button"
                onClick={onToggleExpanded}
                className="mt-3 rounded-md border border-border bg-background-200 px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {expanded ? "Collapse" : "Show full comment"}
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function GitHubCommentComposer({
  repoId,
  number,
  login,
  kind,
  variant = "timeline"
}: {
  repoId: string;
  number: number;
  login?: string;
  kind: ComposerKind;
  variant?: "timeline" | "panel";
}) {
  const queryClient = useQueryClient();
  const online = useNetworkOnline();
  const [body, setBody] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const trimmedBody = body.trim();
  const connected = Boolean(login);
  const canSend = connected && online;
  const detailKey = kind === "pull_request" ? ["prDetail", repoId, number] : ["issueDetail", repoId, number];
  const listKey = kind === "pull_request" ? ["prs", repoId] : ["issues", repoId];

  const submit = useMutation({
    mutationFn: async (action: ComposerAction) => {
      if (!connected) throw new Error("Connect GitHub to comment.");
      if ((action === "comment" || action === "request_changes") && !trimmedBody) {
        throw new Error(action === "request_changes" ? "Request changes needs a message." : "Write a comment before sending.");
      }

      if (kind === "issue") {
        return window.fallback.issues.addComment(repoId, number, trimmedBody, { clientOnline: online });
      }

      if (action === "comment") {
        return window.fallback.prs.addComment(repoId, number, trimmedBody, { clientOnline: online });
      }

      const review: SubmitPullRequestReviewInput = {
        event: action === "approve" ? "APPROVE" : "REQUEST_CHANGES",
        body: trimmedBody || undefined
      };
      return window.fallback.prs.submitReview(repoId, number, review, { clientOnline: online });
    },
    onMutate: () => setLocalError(null),
    onSuccess: async (result) => {
      setBody("");
      if (result?.mode === "queued") {
        toast("Queued locally", { description: "It will send when GitHub is reachable." });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: detailKey }),
        queryClient.invalidateQueries({ queryKey: listKey }),
        kind === "pull_request" ? queryClient.invalidateQueries({ queryKey: ["myPrs"] }) : Promise.resolve(),
        queryClient.invalidateQueries({ queryKey: ["offlineActions"] })
      ]);
    },
    onError: (error) => setLocalError(errorMessage(error))
  });

  const statusText = !connected
    ? "Connect GitHub to comment or review."
    : !online
      ? "Offline. Send will be queued locally."
      : submit.isPending
        ? "Sending to GitHub..."
        : `Posting as ${login}`;
  const disabled = !connected || submit.isPending;
  const sendBlockReason = !connected
    ? "Connect GitHub before sending comments or reviews."
    : submit.isPending
      ? "Wait for the current GitHub write to finish."
      : !online
        ? "Send will be saved locally and posted when GitHub is reachable."
        : null;

  if (variant === "panel") {
    const panelExpanded = composerFocused || Boolean(trimmedBody) || Boolean(localError || submit.error);
    return (
      <div className="shrink-0 border-t border-border bg-background-100 pt-3 pb-3 pr-1">
        <Surface
          tone="elevated"
          className="border-border bg-background-200 shadow-none transition-colors duration-200 focus-within:border-white/[0.16]"
        >
          <div className="flex items-end gap-2 p-2">
            <Textarea
              value={body}
              onFocus={() => setComposerFocused(true)}
              onBlur={() => {
                if (!trimmedBody) setComposerFocused(false);
              }}
              onChange={(event) => setBody(event.currentTarget.value)}
              disabled={!connected || submit.isPending}
              title={sendBlockReason ?? "Reply to this pull request."}
              className={`github-reply-textarea min-h-0 flex-1 resize-none overflow-hidden border-none bg-transparent px-1 py-1 text-sm leading-5 text-neutral-200 shadow-none transition-[height,color,background-color] duration-200 ease-out placeholder:text-neutral-600 focus-visible:ring-0 disabled:opacity-60 ${
                panelExpanded ? "h-20" : "h-8"
              }`}
              placeholder="Reply..."
            />
            <Button
              onClick={() => submit.mutate("comment")}
              disabled={disabled || !trimmedBody}
              title={sendBlockReason ?? (!trimmedBody ? "Write a reply before sending." : "Post this reply to GitHub.")}
              size="sm"
              className="h-8 w-8 px-0 hover:border-amber-700/40 hover:bg-amber-200/20 hover:text-amber-900"
              aria-label="Send reply"
            >
              <SendHorizontal className="h-4 w-4" />
            </Button>
          </div>
          <div
            className={`grid transition-[grid-template-rows,opacity,border-color] duration-200 ease-out ${
              panelExpanded || localError || submit.error
                ? "grid-rows-[1fr] border-t border-border opacity-100"
                : "grid-rows-[0fr] border-t border-transparent opacity-0"
            }`}
          >
            <div className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  {!canSend && <GitHubAlertIcon className="h-3.5 w-3.5 text-amber-900" />}
                  <span>{statusText}</span>
                </span>
              </div>
            </div>
          </div>
          {(localError || submit.error) && (
            <div className="border-t border-red-700/30 bg-red-200/35 px-3 py-2 text-xs text-red-900">
              {localError ?? errorMessage(submit.error)}
            </div>
          )}
        </Surface>
      </div>
    );
  }

  const composer = (
    <Surface
      tone="elevated"
      className="flex-1 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.03)] transition-colors focus-within:border-white/[0.16]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] bg-[var(--surface-raised)] px-4 py-2">
        <span className="text-sm font-medium text-neutral-300">Write</span>
        <RepoIdentityControl repoId={repoId} compact allowApply={false} />
      </div>
      <IdentityRiskNotice repoId={repoId} action="github" className="mx-4 my-2" />
      <Textarea
        value={body}
        onChange={(event) => setBody(event.currentTarget.value)}
        disabled={!connected || submit.isPending}
        title={sendBlockReason ?? "Write a GitHub comment or review summary."}
        className="w-full min-h-[104px] resize-y border-none bg-transparent p-4 text-sm leading-6 text-neutral-200 placeholder:text-neutral-600 disabled:opacity-60"
        placeholder={kind === "pull_request" ? "Leave a comment or review summary..." : "Leave a comment..."}
      />
      {(localError || submit.error) && (
        <div className="border-t border-red-700/30 bg-red-200/35 px-4 py-2 text-xs text-red-900">
          {localError ?? errorMessage(submit.error)}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] bg-[#151517] px-3 py-2 text-xs text-neutral-500">
        <span className="flex items-center space-x-1.5">
          {!canSend && <GitHubAlertIcon className="w-4 h-4 text-amber-900" />}
          <span>{statusText}</span>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {kind === "pull_request" && (
            <Button
              onClick={() => submit.mutate("approve")}
              disabled={disabled}
              title={sendBlockReason ?? "Approve this pull request."}
              variant="secondary"
              size="sm"
              className="border-green-700/30 bg-green-200/35 text-green-900 hover:border-green-700/50 hover:bg-green-200/50"
            >
              Approve
            </Button>
          )}
          <Button
            onClick={() => submit.mutate("comment")}
            disabled={disabled || !trimmedBody}
            title={sendBlockReason ?? (!trimmedBody ? "Write a comment before sending." : "Post this comment to GitHub.")}
            size="sm"
          >
            Comment
          </Button>
          {kind === "pull_request" && (
            <Button
              onClick={() => submit.mutate("request_changes")}
              disabled={disabled || !trimmedBody}
              title={sendBlockReason ?? (!trimmedBody ? "Write a request changes message before sending." : "Request changes on GitHub.")}
              variant="secondary"
              size="sm"
              className="border-red-700/30 bg-red-200/35 text-red-900 hover:border-red-700/50 hover:bg-red-200/50"
            >
              Request changes
            </Button>
          )}
        </div>
      </div>
    </Surface>
  );

  return (
    <div className="ml-5 border-l border-[#222326] pt-2">
      <div className="flex space-x-4 relative pl-8">
        <div className="absolute left-[-20px] top-0 w-10 h-10 bg-[#0b0b0c] flex items-center justify-center">
          <Avatar seed={login ?? "you"} size="md" />
        </div>
        {composer}
      </div>
    </div>
  );
}

export function QueuedWritebackRows({
  repoId,
  entityType,
  number
}: {
  repoId: string;
  entityType: "issue" | "pull_request";
  number: number;
}) {
  const [actions, setActions] = useState<OfflineAction[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = await window.fallback.offlineActions.list({ repoId, entityType, entityNumber: number });
      if (!cancelled) setActions(next);
    };
    void load();
    const off = window.fallback.events.onOfflineActionsChanged((payload) => {
      if (!payload.repoId || payload.repoId === repoId) void load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [entityType, number, repoId]);

  if (actions.length === 0) return null;

  return (
    <div className="space-y-2">
      {actions.map((action) => (
        <div key={action.id} className="rounded-md border border-amber-700/25 bg-amber-200/10 px-3 py-2 text-xs text-amber-900">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{offlineActionLabel(action.actionType)} queued</span>
            <span className="font-mono text-[11px] opacity-80">{action.status.replace("_", " ")}</span>
          </div>
          <div className="mt-1 line-clamp-2 break-words leading-5 text-muted-foreground">{offlineActionPreview(action.body)}</div>
          {action.lastError && <div className="mt-1 leading-5">{action.lastError}</div>}
        </div>
      ))}
    </div>
  );
}

export function prUnderlineTabClass(active: boolean): string {
  return `relative flex h-full items-center px-1 text-[15px] font-semibold transition-colors ${
    active
      ? "text-neutral-100 after:absolute after:bottom-0 after:left-0 after:h-px after:w-full after:bg-neutral-100"
      : "text-neutral-600 hover:text-neutral-300"
  }`;
}

export function timestamp(value: string | null): number {
  return value ? Date.parse(value) : 0;
}

function commentPreview(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCommentBody(value: string | null): string {
  return (value ?? "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_match, label: string) => (label ? `[${label}]` : ""))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function ReviewHunkPreview({ diffHunk }: { diffHunk: string }) {
  const lines = diffHunk.split("\n");
  const shown = lines.slice(0, 14);
  const hiddenCount = Math.max(0, lines.length - shown.length);
  return (
    <div className="border-b border-[#222326] bg-black">
      <pre className="px-4 py-3 text-xs leading-5 text-neutral-400 whitespace-pre-wrap font-mono">{shown.join("\n")}</pre>
      {hiddenCount > 0 && (
        <div className="border-t border-[var(--surface-raised)] px-4 py-2 text-xs text-neutral-600">{hiddenCount} more hunk lines</div>
      )}
    </div>
  );
}
