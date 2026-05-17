import type { RepoGroup } from "../../../shared/domain/repo-group";
import { isCommitSearchQuery } from "../../../shared/commit-history-search";
import type { CommandPaletteGroup, CommandPaletteItem, CommandPaletteMode, PaletteGroupFilter } from "./CommandPalette.types";

export function normalizePaletteQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

export function detectPaletteMode(query: string): CommandPaletteMode {
  const normalized = normalizePaletteQuery(query);
  if (normalized.startsWith("@")) return "repo-picker";
  if (normalized.startsWith(">")) return "action";
  if (isCommitSearchQuery(normalized)) return "commit";
  return "root";
}

export function paletteGroupFilter(query: string, groups: RepoGroup[]): PaletteGroupFilter | null {
  const token = query.match(/(?:^|\s)group:("[^"]+"|'[^']+'|\S+)/i)?.[1];
  if (!token) return null;
  const name = token.replace(/^["']|["']$/g, "").toLowerCase();
  const group = groups.find((item) => item.name.toLowerCase() === name || item.name.toLowerCase().includes(name));
  return group ? { id: group.id, name: group.name } : null;
}

export function stripPaletteGroupFilter(query: string): string {
  return query.replace(/(?:^|\s)group:("[^"]+"|'[^']+'|\S+)/i, " ").trim();
}

export function actionQuery(query: string): string {
  return normalizePaletteQuery(query).replace(/^>/, "").trim();
}

export function repoPickerQuery(query: string): string {
  return normalizePaletteQuery(query).replace(/^@/, "").trim();
}

export function rankItemMatch(item: Pick<CommandPaletteItem, "title" | "searchTerms" | "kind">, query: string): number | null {
  const needle = normalizePaletteQuery(query).toLowerCase();
  if (!needle) return 0;

  const title = item.title.toLowerCase();
  const terms = [title, ...item.searchTerms.map((term) => term.toLowerCase()).filter(Boolean)];
  const basenameTerms = terms.map((term) => term.split("/").at(-1) ?? term);
  const segmentTerms = terms.flatMap((term) => term.split(/[/\s:#.-]+/).filter(Boolean));
  const kindBoost = item.kind === "action" || item.kind === "submenu" ? -0.35 : item.kind === "repo" ? -0.2 : 0;

  if (terms.some((term) => term === needle)) return 0 + kindBoost;
  if (basenameTerms.some((term) => term === needle)) return 0.4 + kindBoost;
  if (terms.some((term) => term.startsWith(needle))) return 1 + kindBoost;
  if (basenameTerms.some((term) => term.startsWith(needle))) return 1.25 + kindBoost;
  if (segmentTerms.some((term) => term === needle || term.startsWith(needle))) return 2 + kindBoost;
  if (terms.some((term) => term.includes(needle))) return 3 + kindBoost;

  const compactNeedle = needle.replace(/[\s/_-]+/g, "");
  if (compactNeedle && terms.some((term) => term.replace(/[\s/_-]+/g, "").includes(compactNeedle))) return 4 + kindBoost;
  return null;
}

export function filterAndRankItems(items: CommandPaletteItem[], query: string, limit = 12): CommandPaletteItem[] {
  const needle = normalizePaletteQuery(query);
  if (!needle) return items.slice(0, limit);
  return items
    .map((item, index) => ({ item, index, score: rankItemMatch(item, needle) }))
    .filter((entry): entry is { item: CommandPaletteItem; index: number; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index || a.item.title.localeCompare(b.item.title))
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function filterGroups(groups: CommandPaletteGroup[], query: string, limitPerGroup = 8): CommandPaletteGroup[] {
  const needle = normalizePaletteQuery(query);
  return groups
    .map((group) => ({
      ...group,
      items: needle ? filterAndRankItems(group.items, needle, limitPerGroup) : group.items.slice(0, limitPerGroup)
    }))
    .filter((group) => group.items.length > 0);
}

export function flattenGroups(groups: CommandPaletteGroup[]): CommandPaletteItem[] {
  return groups.flatMap((group) => group.items);
}

export interface ShortcutResolution {
  item: CommandPaletteItem | null;
  pendingKeys: string[];
}

export function resolveShortcutChord(items: CommandPaletteItem[], previousKeys: string[], key: string | KeyboardEvent): ShortcutResolution {
  const normalizedKey = typeof key === "string" ? normalizeShortcutKey(key) : shortcutKeyFromKeyboardEvent(key);
  if (!normalizedKey) return { item: null, pendingKeys: [] };

  const nextKeys = [...previousKeys.map(normalizeShortcutKey).filter(Boolean), normalizedKey];
  const nextMatch = shortcutMatch(items, nextKeys);
  if (nextMatch.item || nextMatch.pendingKeys.length > 0) return nextMatch;

  return shortcutMatch(items, [normalizedKey]);
}

function shortcutMatch(items: CommandPaletteItem[], keys: string[]): ShortcutResolution {
  const shortcutItems = items.filter((item) => item.shortcut && item.shortcut.length > 0);
  const exact = shortcutItems.find((item) => shortcutsEqual(item.shortcut ?? [], keys)) ?? null;
  const hasLongerMatch = shortcutItems.some((item) => shortcutStartsWith(item.shortcut ?? [], keys) && item.shortcut!.length > keys.length);

  if (exact && !hasLongerMatch) return { item: exact, pendingKeys: [] };
  if (hasLongerMatch) return { item: null, pendingKeys: keys };
  return { item: null, pendingKeys: [] };
}

function shortcutsEqual(shortcut: string[], keys: string[]): boolean {
  return shortcut.length === keys.length && shortcut.every((key, index) => normalizeShortcutKey(key) === keys[index]);
}

function shortcutStartsWith(shortcut: string[], keys: string[]): boolean {
  return keys.every((key, index) => normalizeShortcutKey(shortcut[index] ?? "") === key);
}

function normalizeShortcutKey(key: string): string {
  return key
    .split("+")
    .map((part) => normalizeShortcutPart(part))
    .filter((part): part is string => Boolean(part))
    .join("+");
}

function shortcutKeyFromKeyboardEvent(event: KeyboardEvent): string {
  if (event.key === "Control" || event.key === "Alt" || event.key === "Shift" || event.key === "Meta") return "";
  const key = normalizeShortcutBaseKey(event.key);
  if (!key) return "";
  const parts = [
    event.ctrlKey ? "CTRL" : "",
    event.altKey ? "ALT" : "",
    event.shiftKey ? "SHIFT" : "",
    event.metaKey ? "CMD" : "",
    key
  ].filter(Boolean);
  return parts.join("+");
}

function normalizeShortcutPart(part: string): string | null {
  const normalized = part.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "CONTROL" || normalized === "CTRL") return "CTRL";
  if (normalized === "OPTION" || normalized === "ALT") return "ALT";
  if (normalized === "SHIFT") return "SHIFT";
  if (normalized === "COMMAND" || normalized === "CMD" || normalized === "META") return "CMD";
  return normalizeShortcutBaseKey(normalized);
}

function normalizeShortcutBaseKey(key: string): string {
  if (key.length === 1 && /^[a-z0-9,.[\]\\/;'"`=-]$/i.test(key)) return key.toUpperCase();
  const normalized = key.toLowerCase();
  if (normalized === "enter" || normalized === "return") return "ENTER";
  if (normalized === " ") return "SPACE";
  if (normalized === "space") return "SPACE";
  if (normalized === "tab") return "TAB";
  if (normalized === "escape" || normalized === "esc") return "ESC";
  if (normalized === "backspace") return "BACKSPACE";
  if (normalized === "delete" || normalized === "del") return "DELETE";
  return "";
}
