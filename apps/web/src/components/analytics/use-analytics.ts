'use client';

import { useEffect, useState } from 'react';

export type SectionState<T> =
  { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: T };

/**
 * Loads one analytics section for a key; a new key starts over, a retry
 * reloads. Each section loads on its own, so one failure leaves the rest of
 * the dashboard usable (the "partial" state).
 */
export function useAnalytics<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
): { state: SectionState<T>; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; state: SectionState<T> } | null>(
    null,
  );
  const token = key === null ? null : `${key}#${attempt}`;

  useEffect(() => {
    if (token === null) return;
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => setResult({ key: token, state: { status: 'ok', data } }))
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({ key: token, state: { status: 'error' } });
      });
    return () => controller.abort();
    // `load` is recreated each render; `token` captures everything it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return {
    state: result && result.key === token ? result.state : { status: 'loading' },
    retry: () => setAttempt((a) => a + 1),
  };
}
