import React, { useMemo } from "react";

type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; text: string; language?: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: MarkdownListItem[] };

interface MarkdownListItem {
  text: string;
  checked?: boolean;
}

export function MarkdownBody({
  value,
  empty = "No content cached.",
  repoUrl,
  className = ""
}: {
  value?: string | null;
  empty?: string;
  repoUrl?: string | null;
  className?: string;
}) {
  const blocks = useMemo(() => parseMarkdownBlocks(value ?? ""), [value]);
  if (blocks.length === 0) return <p className="text-sm text-neutral-500">{empty}</p>;
  return (
    <div className={`markdown-body max-w-[76ch] text-sm leading-6 text-neutral-300 ${className}`}>
      {blocks.map((block, index) => renderMarkdownBlock(block, index, repoUrl))}
    </div>
  );
}

function renderMarkdownBlock(block: MarkdownBlock, index: number, repoUrl?: string | null): React.ReactNode {
  if (block.kind === "heading") {
    const Tag = `h${Math.min(Math.max(block.level, 1), 6)}` as keyof React.JSX.IntrinsicElements;
    return <Tag key={index}>{renderMarkdownInline(block.text, repoUrl)}</Tag>;
  }
  if (block.kind === "code") {
    return (
      <pre key={index}>
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.kind === "quote") {
    return (
      <blockquote key={index}>
        {parseMarkdownBlocks(block.text).map((child, childIndex) => renderMarkdownBlock(child, childIndex, repoUrl))}
      </blockquote>
    );
  }
  if (block.kind === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag key={index}>
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>
            {item.checked !== undefined && <input type="checkbox" checked={item.checked} readOnly tabIndex={-1} aria-hidden="true" />}
            {renderMarkdownInline(item.text, repoUrl)}
          </li>
        ))}
      </Tag>
    );
  }
  return <p key={index}>{renderMarkdownInline(block.text, repoUrl)}</p>;
}

function parseMarkdownBlocks(value: string): MarkdownBlock[] {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([\w-]+)?\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: "code", language: fence[1], text: codeLines.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", text: quoteLines.join("\n") });
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
    if (listMatch) {
      const ordered = /\d+[.)]/.test(listMatch[2]);
      const items: MarkdownListItem[] = [];
      while (index < lines.length) {
        const itemMatch = (lines[index] ?? "").match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
        if (!itemMatch || /\d+[.)]/.test(itemMatch[2]) !== ordered) break;
        const task = itemMatch[3].match(/^\[([ xX])]\s+(.+)$/);
        items.push(task ? { text: task[2], checked: task[1].toLowerCase() === "x" } : { text: itemMatch[3] });
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraphLines: string[] = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index]?.trim() &&
      !/^```/.test(lines[index] ?? "") &&
      !/^(#{1,6})\s+/.test(lines[index] ?? "") &&
      !/^>\s?/.test(lines[index] ?? "") &&
      !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[index] ?? "")
    ) {
      paragraphLines.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function renderMarkdownInline(text: string, repoUrl?: string | null): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const codePattern = /`([^`]+)`/g;
  let cursor = 0;
  let codeMatch: RegExpExecArray | null;
  while ((codeMatch = codePattern.exec(text))) {
    if (codeMatch.index > cursor) nodes.push(...renderMarkdownText(text.slice(cursor, codeMatch.index), repoUrl, nodes.length));
    nodes.push(<code key={`code-${nodes.length}`}>{codeMatch[1]}</code>);
    cursor = codeMatch.index + codeMatch[0].length;
  }
  if (cursor < text.length) nodes.push(...renderMarkdownText(text.slice(cursor), repoUrl, nodes.length));
  return nodes;
}

function renderMarkdownText(text: string, repoUrl: string | null | undefined, offset: number): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern =
    /\[!\[([^\]]*)]\([^)]+\)]\(([^)]+)\)|!\[([^\]]*)]\(([^)]+)\)|\[([^\]]+)]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<)]+)|(^|[^\w/])#(\d+)\b/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const matchedText = match[0];
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    if (match[1] !== undefined && match[2]) {
      nodes.push(
        <MarkdownImageBadge key={`linked-image-${offset}-${nodes.length}`} label={match[1]} href={resolveMarkdownHref(match[2], repoUrl)} />
      );
    } else if (match[3] !== undefined) {
      nodes.push(<MarkdownImageBadge key={`image-${offset}-${nodes.length}`} label={match[3]} />);
    } else if (match[5] && match[6]) {
      nodes.push(
        <MarkdownExternalLink key={`link-${offset}-${nodes.length}`} href={match[6]}>
          {match[5]}
        </MarkdownExternalLink>
      );
    } else if (match[7]) {
      const href = trimTrailingUrlPunctuation(match[7]);
      nodes.push(
        <MarkdownExternalLink key={`url-${offset}-${nodes.length}`} href={href}>
          {href}
        </MarkdownExternalLink>
      );
      const trailing = match[7].slice(href.length);
      if (trailing) nodes.push(trailing);
    } else if (match[9]) {
      const prefix = match[8] ?? "";
      if (prefix) nodes.push(prefix);
      const issueHref = repoUrl ? `${repoUrl}/issues/${match[9]}` : null;
      nodes.push(
        issueHref ? (
          <MarkdownExternalLink key={`ref-${offset}-${nodes.length}`} href={issueHref}>
            #{match[9]}
          </MarkdownExternalLink>
        ) : (
          `#${match[9]}`
        )
      );
    }
    cursor = match.index + matchedText.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function MarkdownImageBadge({ label, href }: { label?: string; href?: string | null }) {
  const value = label?.trim() || "Image";
  const content = <span className="markdown-image-badge">{value}</span>;
  return href ? <MarkdownExternalLink href={href}>{content}</MarkdownExternalLink> : content;
}

function MarkdownExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  const safeHref = safeExternalUrl(href);
  if (!safeHref) return <>{children}</>;
  return (
    <a
      href={safeHref}
      onClick={(event) => {
        event.preventDefault();
        void window.fallback.shell.openExternal(safeHref);
      }}
    >
      {children}
    </a>
  );
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(trimTrailingUrlPunctuation(value));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export const safeExternalUrlForTest = safeExternalUrl;

function trimTrailingUrlPunctuation(value: string): string {
  return value.replace(/[),.;:]+$/g, "");
}

function resolveMarkdownHref(value: string, repoUrl?: string | null): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  if (/^http:\/\//i.test(trimmed)) return null;
  if (!repoUrl) return null;
  if (trimmed.startsWith("#")) return `${repoUrl}${trimmed}`;
  const normalized = trimmed.replace(/^\.\//, "").replace(/^\/+/, "");
  return normalized ? `${repoUrl}/blob/HEAD/${normalized}` : repoUrl;
}

export function githubRepoUrlFromEntityUrl(value?: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/(?:issues|pull)\/\d+/);
  return match?.[1] ?? null;
}
