import assert from "node:assert/strict";
import {
  defaultSavedEntitySearchName,
  deleteSavedEntitySearch,
  loadSavedEntitySearches,
  persistSavedEntitySearches,
  savedEntitySearchesFor,
  savedEntitySearchesStorageKey,
  upsertSavedEntitySearch,
  type SavedSearchStorage
} from "../src/renderer/features/github-work/saved-entity-searches.js";

class MemoryStorage implements SavedSearchStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const now = "2026-05-15T12:00:00.000Z";
const later = "2026-05-15T12:30:00.000Z";
const storage = new MemoryStorage();

let searches = upsertSavedEntitySearch([], {
  id: "saved-1",
  kind: "pr",
  repoId: "repo-1",
  name: "Needs review",
  query: "review-requested:@me status:failing",
  now
});

assert.equal(searches.length, 1);
assert.equal(searches[0]?.name, "Needs review");
assert.equal(searches[0]?.query, "review-requested:@me status:failing");

searches = upsertSavedEntitySearch(searches, {
  id: "ignored-new-id",
  kind: "pr",
  repoId: "repo-1",
  name: "needs review",
  query: "review-requested:@me",
  now: later
});

assert.equal(searches.length, 1);
assert.equal(searches[0]?.id, "saved-1");
assert.equal(searches[0]?.query, "review-requested:@me");
assert.equal(searches[0]?.createdAt, now);
assert.equal(searches[0]?.updatedAt, later);

searches = upsertSavedEntitySearch(searches, {
  id: "saved-2",
  kind: "issue",
  repoId: "repo-1",
  name: "Bugs",
  query: "label:bug",
  now
});

searches = upsertSavedEntitySearch(searches, {
  id: "saved-3",
  kind: "pr",
  repoId: "repo-2",
  name: "Other repo",
  query: "author:@me",
  now
});

assert.deepEqual(
  savedEntitySearchesFor(searches, "pr", "repo-1").map((search) => search.id),
  ["saved-1"]
);
assert.deepEqual(
  savedEntitySearchesFor(searches, "issue", "repo-1").map((search) => search.id),
  ["saved-2"]
);

persistSavedEntitySearches(storage, searches);
assert.equal(storage.getItem(savedEntitySearchesStorageKey)?.includes("saved-1"), true);
assert.equal(loadSavedEntitySearches(storage).length, 3);

storage.setItem(savedEntitySearchesStorageKey, JSON.stringify([{ id: 1 }, searches[0]]));
assert.deepEqual(
  loadSavedEntitySearches(storage).map((search) => search.id),
  ["saved-1"]
);

assert.equal(defaultSavedEntitySearchName("  label:bug   assignee:@me  "), "label:bug assignee:@me");
assert.equal(upsertSavedEntitySearch(searches, { id: "empty", kind: "pr", repoId: "repo-1", name: "", query: "", now }).length, 3);
assert.equal(
  deleteSavedEntitySearch(searches, "saved-2").some((search) => search.id === "saved-2"),
  false
);

console.log("Saved entity search tests ok");
