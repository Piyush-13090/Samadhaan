'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * A boolean preference backed by `localStorage`.
 *
 * `localStorage` is an external store, so `useSyncExternalStore` is the correct
 * primitive: it reads a different snapshot on the server (the fallback) than on
 * the client without a render-triggering effect, which is what keeps the value
 * hydration-safe.
 *
 * Storage access is wrapped throughout — private browsing and blocked site data
 * make every call a potential throw, and a failed preference read must never
 * take a page down. When storage is unavailable the value simply does not
 * persist.
 */

const listeners = new Set<() => void>();

/** Notifies subscribers in this tab; the `storage` event only fires in others. */
function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener('storage', onStoreChange);

  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

export function usePersistedBoolean(
  key: string,
  fallback = false,
): [boolean, (value: boolean) => void] {
  // Returns a primitive, so repeated reads compare equal and cannot loop.
  const getSnapshot = useCallback((): boolean => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : raw === 'true';
    } catch {
      return fallback;
    }
  }, [key, fallback]);

  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Preference will not persist; the UI still updates via `emit`.
      }
      emit();
    },
    [key],
  );

  return [value, setValue];
}
