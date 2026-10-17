'use client';

import {
  BookOpen,
  Building2,
  Clock,
  FileText,
  Loader2,
  MapPin,
  Search,
  Tag,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { SEARCH_MIN_QUERY_LENGTH, type SearchSuggestion } from '@samadhaan/shared';
import { cn } from '@/lib/cn';
import { searchQueryString } from '@/lib/search';
import {
  clearRecentSearches,
  fetchRecentSearches,
  fetchSuggestions,
} from '@/services/search.service';

const GROUPS: Array<{ kind: SearchSuggestion['kind']; label: string; icon: LucideIcon }> =
  [
    { kind: 'RECENT', label: 'Recent searches', icon: Clock },
    { kind: 'CATEGORY', label: 'Categories', icon: Tag },
    { kind: 'PROBLEM', label: 'Problems', icon: FileText },
    { kind: 'ORGANIZATION', label: 'Organisations', icon: Building2 },
    { kind: 'KNOWLEDGE', label: 'Knowledge', icon: BookOpen },
    { kind: 'CITY', label: 'Places', icon: MapPin },
  ];
const DEBOUNCE_MS = 200;

/**
 * The global search box (Prompt 25): an ARIA 1.2 combobox.
 *
 * - Ctrl/⌘ + K focuses it from anywhere.
 * - Suggestions are debounced, need at least two characters, and cancel the
 *   previous request; they are cheap server-side lookups, never AI.
 * - ↑/↓ move through suggestions, Enter opens one (or searches the text),
 *   Escape closes the list and then clears the box.
 * - Focusing an empty box shows recent searches, which can be cleared.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const router = useRouter();
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SearchSuggestion[]>([]);
  const [recentShown, setRecentShown] = useState(false);

  // Ctrl/⌘ + K, from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Suggestions, debounced and cancellable.
  useEffect(() => {
    if (!open) return;
    const q = value.trim();
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        setLoading(true);
        const request =
          q.length >= SEARCH_MIN_QUERY_LENGTH
            ? fetchSuggestions(q, controller.signal).then((r) => r.suggestions)
            : fetchRecentSearches(controller.signal).then((r) =>
                r.items.slice(0, 6).map<SearchSuggestion>((label) => ({
                  kind: 'RECENT',
                  label,
                  href: `/search${searchQueryString({ q: label })}`,
                  detail: null,
                })),
              );
        request
          .then((next) => {
            setItems(next);
            setRecentShown(q.length < SEARCH_MIN_QUERY_LENGTH);
            setActive(-1);
          })
          .catch(() => {
            if (!controller.signal.aborted) setItems([]);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      q.length >= SEARCH_MIN_QUERY_LENGTH ? DEBOUNCE_MS : 0,
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [value, open]);

  // Options in display order (grouped), so ↑/↓ follow what is seen.
  const ordered = useMemo(
    () => GROUPS.flatMap((g) => items.filter((i) => i.kind === g.kind)),
    [items],
  );

  const go = (href: string) => {
    setOpen(false);
    setActive(-1);
    router.push(href);
  };
  const submit = () => {
    const q = value.trim();
    if (q.length >= SEARCH_MIN_QUERY_LENGTH) go(`/search${searchQueryString({ q })}`);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((a) => (ordered.length ? (a + 1) % ordered.length : -1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((a) => (ordered.length ? (a <= 0 ? ordered.length - 1 : a - 1) : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = ordered[active];
      if (open && chosen) go(chosen.href);
      else submit();
    } else if (event.key === 'Escape') {
      if (open) setOpen(false);
      else setValue('');
    }
  };

  const showList =
    open &&
    (ordered.length > 0 || (value.trim().length >= SEARCH_MIN_QUERY_LENGTH && !loading));
  const optionId = (index: number) => `${id}-option-${index}`;

  return (
    <div className={cn('relative w-full max-w-md', className)}>
      <div className="relative flex items-center">
        <Search
          className="pointer-events-none absolute left-3 size-4 text-ink-subtle"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search Samadhaan"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          placeholder="Search Samadhaan…"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className={cn(
            'h-9 w-full rounded-control border border-border bg-subtle/60 pr-16 pl-9',
            'type-body-sm text-ink placeholder:text-ink-subtle',
            'hover:bg-subtle focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20',
          )}
        />
        <div className="absolute right-2 flex items-center gap-1">
          {loading && (
            <Loader2 className="size-4 animate-spin text-ink-subtle" aria-hidden="true" />
          )}
          {value ? (
            <button
              type="button"
              aria-label="Clear search"
              className="rounded p-0.5 text-ink-subtle hover:text-ink"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setValue('');
                inputRef.current?.focus();
              }}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : (
            <kbd className="hidden rounded border border-border px-1 type-caption text-ink-subtle lg:inline">
              Ctrl K
            </kbd>
          )}
        </div>
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label="Search suggestions"
        hidden={!showList}
        className="absolute inset-x-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-panel border border-border bg-surface p-1 shadow-overlay"
        onMouseDown={(e) => e.preventDefault()}
      >
        {ordered.length === 0 ? (
          <p className="px-3 py-2 type-body-sm text-ink-subtle">
            No suggestions. Press Enter to search for “{value.trim()}”.
          </p>
        ) : (
          GROUPS.map((group) => {
            const groupItems = ordered.filter((i) => i.kind === group.kind);
            if (groupItems.length === 0) return null;
            const Icon = group.icon;
            return (
              <div key={group.kind} role="group" aria-label={group.label}>
                <div className="flex items-center justify-between px-3 pt-2 pb-1 type-overline text-ink-subtle">
                  <span>{group.label}</span>
                  {group.kind === 'RECENT' && recentShown && (
                    <button
                      type="button"
                      className="type-caption normal-case text-primary hover:underline"
                      onClick={() => {
                        void clearRecentSearches().then(() => setItems([]));
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {groupItems.map((item) => {
                  const index = ordered.indexOf(item);
                  return (
                    <div
                      key={`${item.kind}-${item.href}-${item.label}`}
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === active}
                      onClick={() => go(item.href)}
                      onMouseEnter={() => setActive(index)}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-control px-3 py-2 type-body-sm',
                        index === active ? 'bg-primary-soft text-primary' : 'text-ink',
                      )}
                    >
                      <Icon
                        className="size-4 shrink-0 text-ink-subtle"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.detail && (
                        <span className="shrink-0 type-caption text-ink-subtle">
                          {item.detail}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
        {value.trim().length >= SEARCH_MIN_QUERY_LENGTH && (
          <button
            type="button"
            className="mt-1 flex w-full items-center gap-2 rounded-control border-t border-border px-3 py-2 text-left type-body-sm text-primary hover:bg-subtle"
            onClick={submit}
          >
            <Search className="size-4" aria-hidden="true" />
            Search everything for “{value.trim()}”
          </button>
        )}
      </div>
    </div>
  );
}
