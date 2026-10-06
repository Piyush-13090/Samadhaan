'use client';

import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { MapPin, Search } from 'lucide-react';
import type { GeocodeResult } from '@samadhaan/shared';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api-error';
import { searchPlaces } from '@/services/map.service';

/** Typing pause before a search is sent. */
export const SEARCH_DEBOUNCE_MS = 400;

/**
 * Search for a city, locality or address, and jump the map there.
 *
 * A combobox in the ARIA sense: the input owns a listbox of results, arrow
 * keys move through them, Enter picks one, Escape closes. Results come from
 * the API's geocoder — never a third party called from the browser.
 *
 * When search is unavailable it says so and points at the alternative —
 * panning the map — rather than failing silently.
 */
export function MapSearch({
  onSelect,
  placeholder = 'Search a city, locality or address',
  className,
}: {
  onSelect: (result: GeocodeResult) => void;
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setStatus('loading');
      searchPlaces(trimmed, controller.signal)
        .then((found) => {
          setResults(found);
          setStatus('ready');
          setActive(found.length > 0 ? 0 : -1);
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          setStatus('error');
          setError(
            caught instanceof ApiError && caught.status === 503
              ? caught.message
              : "Couldn't search right now. You can still move the map to find a place.",
          );
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  function choose(result: GeocodeResult) {
    onSelect(result);
    setQuery(result.label.split(',')[0] ?? result.label);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      const result = results[active];
      if (open && result) {
        event.preventDefault();
        choose(result);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const showList = open && trimmed.length >= 2 && status !== 'idle';

  return (
    <div className={cn('relative', className)}>
      <label className="relative flex items-center">
        <span className="sr-only">Search for a place</span>
        <Search
          className="pointer-events-none absolute left-3 size-4 text-ink-subtle"
          aria-hidden="true"
        />
        <input
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && active >= 0 ? `${listId}-option-${active}` : undefined
          }
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (event.target.value.trim().length < 2) {
              setStatus('idle');
              setResults([]);
            }
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          className={cn(
            'h-11 w-full rounded-control border border-border-strong bg-surface pr-9 pl-9 type-body-sm text-ink shadow-card',
            'placeholder:text-ink-subtle focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none',
          )}
        />
        {status === 'loading' && (
          <Spinner className="absolute right-3 size-4" label={null} />
        )}
      </label>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Places"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-control border border-border bg-surface p-1 shadow-raised"
        >
          {status === 'error' ? (
            <li role="presentation" className="px-3 py-2 type-caption text-ink-muted">
              {error}
            </li>
          ) : status === 'ready' && results.length === 0 ? (
            <li role="presentation" className="px-3 py-2 type-caption text-ink-muted">
              No places found. Try a nearby landmark or the city name.
            </li>
          ) : (
            results.map((result, index) => (
              <li
                key={`${result.latitude},${result.longitude},${index}`}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  // Before the input's blur closes the list.
                  event.preventDefault();
                  choose(result);
                }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-control px-3 py-2 type-body-sm text-ink',
                  index === active && 'bg-subtle',
                )}
              >
                <MapPin
                  className="mt-0.5 size-4 shrink-0 text-ink-subtle"
                  aria-hidden="true"
                />
                <span className="min-w-0">{result.label}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
