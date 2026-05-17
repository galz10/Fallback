import React, { useEffect, useMemo, useRef, useState } from "react";
import type { IssueSummary, PullRequestSummary } from "../../../shared/domain/github-work";
import type { AttentionItem } from "../../../shared/attention";
import { SearchField } from "../../components/ui";
import {
  applyQuerySuggestion,
  buildFilterSuggestions,
  buildWorkFilterSuggestions,
  type EntityQueryKind,
  type FilterSuggestionOptions,
  type QuerySuggestion
} from "./work-query-language";

export function SimpleSearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  items = [],
  login,
  kinds = ["issue", "pr"],
  suggestionOptions
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  items?: Array<IssueSummary | PullRequestSummary>;
  login?: string;
  kinds?: EntityQueryKind[];
  suggestionOptions?: FilterSuggestionOptions;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focused, setFocused] = useState(false);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const suggestions = useMemo(
    () => buildFilterSuggestions(value, items, login, kinds, suggestionOptions),
    [items, kinds, login, suggestionOptions, value]
  );
  const showMenu = focused && !menuDismissed && suggestions.length > 0;
  const applySuggestion = (suggestion: QuerySuggestion) => {
    const nextValue = applyQuerySuggestion(value, suggestion.value);
    onChange(nextValue);
    setMenuDismissed(false);
    setFocused(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };
  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [value, suggestions.length]);
  useEffect(() => {
    if (!showMenu) return;
    suggestionRefs.current[activeSuggestionIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeSuggestionIndex, showMenu]);

  return (
    <div className="relative min-w-0 flex-1">
      <SearchField
        ref={inputRef}
        aria-label={ariaLabel}
        aria-expanded={showMenu}
        aria-haspopup="listbox"
        aria-activedescendant={showMenu ? `entity-filter-suggestion-${activeSuggestionIndex}` : undefined}
        value={value}
        onChange={(event) => {
          setMenuDismissed(false);
          onChange(event.currentTarget.value);
        }}
        onFocus={() => {
          setMenuDismissed(false);
          setFocused(true);
        }}
        onBlur={() =>
          window.setTimeout(() => {
            setFocused(false);
          }, 120)
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setMenuDismissed(true);
            return;
          }
          if (suggestions.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!showMenu) {
              setMenuDismissed(false);
              setActiveSuggestionIndex(0);
              return;
            }
            setActiveSuggestionIndex((index) => Math.min(index + 1, suggestions.length - 1));
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!showMenu) {
              setMenuDismissed(false);
              setActiveSuggestionIndex(suggestions.length - 1);
              return;
            }
            setActiveSuggestionIndex((index) => Math.max(index - 1, 0));
            return;
          }
          if (!showMenu) return;
          if (event.key === "Enter") {
            event.preventDefault();
            applySuggestion(suggestions[activeSuggestionIndex] ?? suggestions[0]!);
          }
        }}
        type="text"
        placeholder={placeholder}
        density="compact"
      />
      {showMenu && (
        <div
          role="listbox"
          aria-label={`${ariaLabel} suggestions`}
          className="absolute left-0 top-full z-40 mt-1 max-h-[min(26rem,calc(100vh-10rem))] w-96 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-md border border-neutral-800 bg-[#0A0A0A] p-1 shadow-2xl"
        >
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.value}:${suggestion.description}`}
              id={`entity-filter-suggestion-${index}`}
              ref={(element) => {
                suggestionRefs.current[index] = element;
              }}
              role="option"
              aria-selected={index === activeSuggestionIndex}
              type="button"
              onMouseEnter={() => setActiveSuggestionIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                applySuggestion(suggestion);
              }}
              className={`flex w-full items-center justify-between gap-4 rounded px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                index === activeSuggestionIndex ? "bg-neutral-900 text-white" : "text-neutral-300 hover:bg-neutral-900"
              }`}
            >
              <span className="min-w-0 truncate font-mono">{suggestion.value}</span>
              <span className="shrink-0 text-xs text-neutral-600">{suggestion.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MyWorkSearchInput({
  value,
  onChange,
  items
}: {
  value: string;
  onChange: (value: string) => void;
  items: AttentionItem[];
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focused, setFocused] = useState(false);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const suggestions = useMemo(() => buildWorkFilterSuggestions(value, items), [items, value]);
  const showMenu = focused && !menuDismissed && suggestions.length > 0;
  const applySuggestion = (suggestion: QuerySuggestion) => {
    onChange(applyQuerySuggestion(value, suggestion.value));
    setMenuDismissed(false);
    setFocused(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [suggestions.length, value]);
  useEffect(() => {
    if (!showMenu) return;
    suggestionRefs.current[activeSuggestionIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeSuggestionIndex, showMenu]);

  return (
    <div className="relative min-w-[220px]">
      <SearchField
        ref={inputRef}
        aria-expanded={showMenu}
        aria-haspopup="listbox"
        aria-activedescendant={showMenu ? `work-filter-suggestion-${activeSuggestionIndex}` : undefined}
        value={value}
        onChange={(event) => {
          setMenuDismissed(false);
          onChange(event.currentTarget.value);
        }}
        onFocus={() => {
          setMenuDismissed(false);
          setFocused(true);
        }}
        onBlur={() =>
          window.setTimeout(() => {
            setFocused(false);
          }, 120)
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setMenuDismissed(true);
            return;
          }
          if (suggestions.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!showMenu) {
              setMenuDismissed(false);
              setActiveSuggestionIndex(0);
              return;
            }
            setActiveSuggestionIndex((index) => Math.min(index + 1, suggestions.length - 1));
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!showMenu) {
              setMenuDismissed(false);
              setActiveSuggestionIndex(suggestions.length - 1);
              return;
            }
            setActiveSuggestionIndex((index) => Math.max(index - 1, 0));
            return;
          }
          if (!showMenu) return;
          if (event.key === "Enter") {
            event.preventDefault();
            applySuggestion(suggestions[activeSuggestionIndex] ?? suggestions[0]!);
          }
        }}
        placeholder="Search work"
        aria-label="Search My Work"
        density="compact"
      />
      {showMenu && (
        <div
          role="listbox"
          aria-label="Search My Work suggestions"
          className="absolute left-0 top-full z-40 mt-1 max-h-[min(22rem,calc(100vh-10rem))] w-80 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-md border border-neutral-800 bg-[#0A0A0A] p-1 shadow-2xl"
        >
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.value}:${suggestion.description}`}
              id={`work-filter-suggestion-${index}`}
              ref={(element) => {
                suggestionRefs.current[index] = element;
              }}
              role="option"
              aria-selected={index === activeSuggestionIndex}
              type="button"
              onMouseEnter={() => setActiveSuggestionIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                applySuggestion(suggestion);
              }}
              className={`flex w-full items-center justify-between gap-4 rounded px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                index === activeSuggestionIndex ? "bg-neutral-900 text-white" : "text-neutral-300 hover:bg-neutral-900"
              }`}
            >
              <span className="min-w-0 truncate font-mono">{suggestion.value}</span>
              <span className="shrink-0 text-xs text-neutral-600">{suggestion.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
