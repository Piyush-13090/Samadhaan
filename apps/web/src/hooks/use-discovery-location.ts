'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useGeolocation } from './use-geolocation';

/**
 * Where discovery searches from.
 *
 * Three sources, in descending precision, and the UI says which one is in use:
 *
 *  1. **Device** — browser geolocation, only after the citizen asks for it.
 *  2. **City** — the coarse locality on their profile. Profiles deliberately
 *     store city and state but not coordinates: a civic platform locates
 *     *problems* precisely, not people. So this searches a city rather than a
 *     radius, which is a weaker but honest answer.
 *  3. **None** — nothing known. The dashboard stays usable and asks.
 *
 * Never requested silently. `request()` runs only from a button press, because
 * a permission prompt a citizen did not ask for is how an app teaches people to
 * say no to it.
 */

export type LocationSource = 'device' | 'city' | 'none';

export interface DiscoveryLocation {
  source: LocationSource;
  latitude?: number;
  longitude?: number;
  city?: string;
  /** What to show the citizen, e.g. "Your current location" or "Gurugram". */
  label: string | null;
}

/** Where a granted device fix is remembered between visits. */
const STORAGE_KEY = 'samadhaan.discovery.location';

interface StoredLocation {
  latitude: number;
  longitude: number;
  savedAt: number;
}

/**
 * A remembered fix expires after a day.
 *
 * Long enough that a citizen is not re-prompted on every visit, short enough
 * that yesterday's location does not quietly decide what "nearby" means today.
 */
const STORED_FIX_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * `localStorage` is an external store, so `useSyncExternalStore` is the correct
 * primitive for reading it: it returns a different snapshot on the server than
 * on the client without a render-triggering effect, which is both
 * hydration-safe and free of the cascading re-render an effect would cause.
 *
 * The same shape as `use-persisted-boolean`, for the same reasons.
 */
const listeners = new Set<() => void>();

/** Notifies subscribers in this tab; `storage` only fires in other tabs. */
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

function readStored(): StoredLocation | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredLocation>;
    if (
      typeof parsed.latitude !== 'number' ||
      typeof parsed.longitude !== 'number' ||
      typeof parsed.savedAt !== 'number'
    ) {
      return null;
    }

    if (Date.now() - parsed.savedAt > STORED_FIX_TTL_MS) return null;

    return parsed as StoredLocation;
  } catch {
    // Private browsing, blocked storage, or corrupt JSON. All mean the same
    // thing here: no remembered location.
    return null;
  }
}

function writeStored(latitude: number, longitude: number): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ latitude, longitude, savedAt: Date.now() }),
    );
  } catch {
    // Remembering is a convenience; failing to is not worth surfacing.
  }
  emit();
}

function clearStored(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
  emit();
}

/**
 * The stored fix as a stable string.
 *
 * `useSyncExternalStore` compares snapshots by identity, so returning a fresh
 * object each read would loop forever. The raw string is the natural snapshot;
 * it is parsed once, afterwards.
 */
function getSnapshot(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function getServerSnapshot(): string | null {
  return null;
}

export interface UseDiscoveryLocation {
  location: DiscoveryLocation;
  /** True while the device is being asked. */
  locating: boolean;
  /** Human-readable and actionable; safe to show directly. */
  error: string | null;
  /** Asks the browser for a fix. Only ever called from a user action. */
  request: () => Promise<void>;
  /** Falls back to the profile city, or to nothing. */
  clear: () => void;
}

export function useDiscoveryLocation(profileCity: string | null): UseDiscoveryLocation {
  const geolocation = useGeolocation();

  // Subscribed rather than restored in an effect: no extra render on mount, and
  // the value is correct on the very first client paint.
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const stored = readStored();
  const device = stored
    ? { latitude: stored.latitude, longitude: stored.longitude }
    : null;

  const request = useCallback(async () => {
    const position = await geolocation.request();
    if (!position) return;

    // Writing notifies the store, which re-renders every consumer.
    writeStored(position.latitude, position.longitude);
  }, [geolocation]);

  const clear = useCallback(() => {
    clearStored();
    geolocation.reset();
  }, [geolocation]);

  const location: DiscoveryLocation = device
    ? {
        source: 'device',
        latitude: device.latitude,
        longitude: device.longitude,
        label: 'Your current location',
      }
    : profileCity
      ? { source: 'city', city: profileCity, label: profileCity }
      : { source: 'none', label: null };

  return {
    location,
    locating: geolocation.status === 'locating',
    error: geolocation.error,
    request,
    clear,
  };
}
