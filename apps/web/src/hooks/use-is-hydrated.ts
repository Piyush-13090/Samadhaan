'use client';

import { useSyncExternalStore } from 'react';

/** The hydration state never changes after mount, so nothing to subscribe to. */
const subscribe = () => () => {};

/**
 * False during server rendering and the first client render, true afterwards.
 *
 * Guards output that would legitimately differ between server and client —
 * locale-formatted timestamps, relative times, anything reading `window` — so
 * it renders a stable placeholder first instead of causing a hydration
 * mismatch.
 *
 * `useSyncExternalStore` is the correct primitive here: it reads different
 * snapshots on server and client without a render-triggering effect.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true, // client snapshot
    () => false, // server snapshot
  );
}
