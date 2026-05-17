export type SavedEntitySearchKind = "issue" | "pr";

export interface SavedEntitySearch {
  id: string;
  kind: SavedEntitySearchKind;
  repoId: string;
  name: string;
  query: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedSearchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const savedEntitySearchesStorageKey = "fallback.github-work.saved-entity-searches.v1";

export function defaultSavedEntitySearchName(query: string): string {
  const clean = normalizeWhitespace(query);
  if (!clean) return "Saved filter";
  return truncate(clean, 48);
}

export function loadSavedEntitySearches(storage: SavedSearchStorage): SavedEntitySearch[] {
  const raw = storage.getItem(savedEntitySearchesStorageKey);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSavedEntitySearch) : [];
  } catch {
    return [];
  }
}

export function persistSavedEntitySearches(storage: SavedSearchStorage, searches: SavedEntitySearch[]): void {
  storage.setItem(savedEntitySearchesStorageKey, JSON.stringify(searches));
}

export function savedEntitySearchesFor(
  searches: SavedEntitySearch[],
  kind: SavedEntitySearchKind,
  repoId: string | null
): SavedEntitySearch[] {
  if (!repoId) return [];
  return searches
    .filter((search) => search.kind === kind && search.repoId === repoId)
    .sort((a, b) => a.name.localeCompare(b.name) || b.updatedAt.localeCompare(a.updatedAt));
}

export function upsertSavedEntitySearch(
  searches: SavedEntitySearch[],
  input: {
    id: string;
    kind: SavedEntitySearchKind;
    repoId: string | null;
    name: string;
    query: string;
    now: string;
  }
): SavedEntitySearch[] {
  const repoId = input.repoId?.trim() ?? "";
  const name = normalizeSavedSearchName(input.name);
  const query = input.query.trim();
  if (!repoId || !name || !query) return searches;

  const existingIndex = searches.findIndex(
    (search) => search.kind === input.kind && search.repoId === repoId && search.name.toLowerCase() === name.toLowerCase()
  );
  if (existingIndex >= 0) {
    return searches.map((search, index) =>
      index === existingIndex
        ? {
            ...search,
            name,
            query,
            updatedAt: input.now
          }
        : search
    );
  }

  return [
    ...searches,
    {
      id: input.id,
      kind: input.kind,
      repoId,
      name,
      query,
      createdAt: input.now,
      updatedAt: input.now
    }
  ];
}

export function deleteSavedEntitySearch(searches: SavedEntitySearch[], id: string): SavedEntitySearch[] {
  return searches.filter((search) => search.id !== id);
}

function normalizeSavedSearchName(value: string): string {
  return truncate(normalizeWhitespace(value), 80);
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function isSavedEntitySearch(value: unknown): value is SavedEntitySearch {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    (candidate.kind === "issue" || candidate.kind === "pr") &&
    typeof candidate.repoId === "string" &&
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    typeof candidate.query === "string" &&
    candidate.query.trim().length > 0 &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}
