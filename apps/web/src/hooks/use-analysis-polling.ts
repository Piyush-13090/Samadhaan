'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProblemAnalysisView } from '@samadhaan/shared';
import { ApiError } from '@/lib/api-error';
import { fetchAnalysis, retryAnalysis } from '@/services/problems.service';

/**
 * Polls for an AI analysis until it settles.
 *
 * Polling rather than websockets: analysis completes in seconds, each poll is
 * one indexed read, and there is no realtime infrastructure yet. Resolution
 * rooms will genuinely need websockets — this does not, and building them here
 * would be infrastructure carried for one screen.
 *
 * Polling stops on COMPLETED or FAILED, and after a hard attempt cap, so a
 * stuck analysis cannot leave a tab requesting forever.
 */

const POLL_INTERVAL_MS = 2000;

/** ~2 minutes. Long enough for a slow model, short enough to give up cleanly. */
const MAX_POLLS = 60;

export interface UseAnalysisPolling {
  analysis: ProblemAnalysisView | null;
  /** True while the first result is still unknown. */
  loading: boolean;
  /** True while polling an in-flight analysis. */
  polling: boolean;
  error: string | null;
  /** Requests a fresh analysis and resumes polling. */
  retry: () => Promise<void>;
  retrying: boolean;
}

function isSettled(analysis: ProblemAnalysisView | null): boolean {
  return analysis?.status === 'COMPLETED' || analysis?.status === 'FAILED';
}

export function useAnalysisPolling(
  publicId: string,
  initial: ProblemAnalysisView | null = null,
): UseAnalysisPolling {
  const [analysis, setAnalysis] = useState<ProblemAnalysisView | null>(initial);
  const [loading, setLoading] = useState(initial === null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const polls = useRef(0);
  // Lets the effect read the current value without re-subscribing on every
  // tick, which would reset the interval and poll far faster than intended.
  const analysisRef = useRef(analysis);

  useEffect(() => {
    analysisRef.current = analysis;
  }, [analysis]);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    if (isSettled(initial)) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;

      try {
        const next = await fetchAnalysis(publicId);
        if (cancelled) return;

        setAnalysis(next);
        setError(null);
        setLoading(false);

        polls.current += 1;

        if (!isSettled(next) && polls.current < MAX_POLLS) {
          timer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      } catch (caught) {
        if (cancelled) return;

        setLoading(false);
        // A failed poll is usually transient. Keep trying within the cap
        // rather than declaring the analysis dead on one network blip.
        polls.current += 1;

        if (polls.current >= MAX_POLLS) {
          setError(
            caught instanceof ApiError
              ? caught.message
              : 'Could not check the analysis status.',
          );
        } else {
          timer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      clear();
    };
  }, [publicId, initial, clear]);

  const retry = useCallback(async () => {
    setRetrying(true);
    setError(null);

    try {
      const next = await retryAnalysis(publicId);
      setAnalysis(next);

      // Reset the budget and resume, so a retry gets a full polling window.
      polls.current = 0;
      clear();

      const poll = async () => {
        const latest = await fetchAnalysis(publicId).catch(() => null);
        if (latest) setAnalysis(latest);

        polls.current += 1;

        if (!isSettled(latest) && polls.current < MAX_POLLS) {
          timer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      };

      timer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not start a new analysis.',
      );
    } finally {
      setRetrying(false);
    }
  }, [publicId, clear]);

  return {
    analysis,
    loading,
    polling: !isSettled(analysis) && !error,
    error,
    retry,
    retrying,
  };
}
