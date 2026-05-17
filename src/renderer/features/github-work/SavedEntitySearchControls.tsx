import React, { useEffect, useMemo, useState } from "react";
import { Bookmark, Save, Trash2 } from "lucide-react";
import { Button, Input } from "../../components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { cn } from "../../lib/utils";
import {
  defaultSavedEntitySearchName,
  deleteSavedEntitySearch,
  loadSavedEntitySearches,
  persistSavedEntitySearches,
  savedEntitySearchesFor,
  type SavedEntitySearch,
  type SavedEntitySearchKind,
  type SavedSearchStorage,
  upsertSavedEntitySearch
} from "./saved-entity-searches";

const savedEntitySearchesChangedEvent = "fallback:saved-entity-searches-changed";

export function SavedEntitySearchSaveButton({
  kind,
  repoId,
  query
}: {
  kind: SavedEntitySearchKind;
  repoId: string | null;
  query: string;
}) {
  const { saveSearch } = useSavedEntitySearches(kind, repoId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const canSave = Boolean(repoId && query.trim());

  useEffect(() => {
    if (open) setName(defaultSavedEntitySearchName(query));
  }, [open, query]);

  const saveCurrentSearch = () => {
    if (!canSave) return;
    saveSearch(name, query);
    setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!canSave}
        onClick={() => setOpen(true)}
        title={canSave ? "Save filter" : "Enter a filter before saving"}
      >
        <Save className="size-3.5" />
        Save
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save filter</DialogTitle>
            <DialogDescription>Save the current {kind === "pr" ? "pull request" : "issue"} filter for this repository.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveCurrentSearch();
            }}
          >
            <Input value={name} onChange={(event) => setName(event.currentTarget.value)} aria-label="Saved filter name" autoFocus />
            <div className="rounded-md border border-neutral-800 bg-black px-3 py-2 font-mono text-xs text-neutral-400">{query.trim()}</div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!name.trim() || !canSave}>
                Save filter
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SavedEntitySearchChips({
  kind,
  repoId,
  query,
  onQueryChange
}: {
  kind: SavedEntitySearchKind;
  repoId: string | null;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const { searches, deleteSearch } = useSavedEntitySearches(kind, repoId);
  if (searches.length === 0) return null;

  const activeQuery = query.trim();

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 text-neutral-600">
        <Bookmark className="size-3" />
        Saved
      </span>
      {searches.map((search) => {
        const active = activeQuery === search.query.trim();
        return (
          <span
            key={search.id}
            className={cn(
              "inline-flex max-w-full items-center overflow-hidden rounded-md border bg-[#0A0A0A]",
              active ? "border-neutral-600 text-neutral-100" : "border-neutral-800 text-neutral-400"
            )}
          >
            <button
              type="button"
              title={search.query}
              onClick={() => onQueryChange(search.query)}
              className="min-w-0 truncate px-2 py-1 text-left transition-colors hover:bg-neutral-900 hover:text-neutral-100"
            >
              {search.name}
            </button>
            <button
              type="button"
              aria-label={`Delete saved filter ${search.name}`}
              title={`Delete ${search.name}`}
              onClick={() => deleteSearch(search.id)}
              className="border-l border-neutral-800 px-1.5 py-1 text-neutral-600 transition-colors hover:bg-neutral-900 hover:text-neutral-200"
            >
              <Trash2 className="size-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

function useSavedEntitySearches(kind: SavedEntitySearchKind, repoId: string | null) {
  const [allSearches, setAllSearches] = useState<SavedEntitySearch[]>(() => loadSearchesFromLocalStorage());
  const searches = useMemo(() => savedEntitySearchesFor(allSearches, kind, repoId), [allSearches, kind, repoId]);

  useEffect(() => {
    const refresh = () => setAllSearches(loadSearchesFromLocalStorage());
    window.addEventListener("storage", refresh);
    window.addEventListener(savedEntitySearchesChangedEvent, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(savedEntitySearchesChangedEvent, refresh);
    };
  }, []);

  const persist = (nextSearches: SavedEntitySearch[]) => {
    const storage = localSavedSearchStorage();
    if (storage) persistSavedEntitySearches(storage, nextSearches);
    setAllSearches(nextSearches);
    window.dispatchEvent(new Event(savedEntitySearchesChangedEvent));
  };

  return {
    searches,
    saveSearch(name: string, query: string) {
      const latest = loadSearchesFromLocalStorage();
      persist(
        upsertSavedEntitySearch(latest, {
          id: createSavedSearchId(kind),
          kind,
          repoId,
          name,
          query,
          now: new Date().toISOString()
        })
      );
    },
    deleteSearch(id: string) {
      persist(deleteSavedEntitySearch(loadSearchesFromLocalStorage(), id));
    }
  };
}

function loadSearchesFromLocalStorage(): SavedEntitySearch[] {
  const storage = localSavedSearchStorage();
  return storage ? loadSavedEntitySearches(storage) : [];
}

function localSavedSearchStorage(): SavedSearchStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function createSavedSearchId(kind: SavedEntitySearchKind): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${kind}:${randomId}`;
}
