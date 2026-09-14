'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DuplicateCheckView } from '@samadhaan/shared';
import { ApiError } from '@/lib/api-error';
import {
  confirmDuplicate,
  fetchSimilar,
  rejectDuplicate,
} from '@/services/problems.service';

/**
 * Polls for the duplicate check until it settles.
 *
 * The same contract as `use-analysis-polling`, because it is the same kind of
 * job: a bounded interval, a hard attempt cap so a stuck check cannot leave a
 * tab requesting forever, and a stop on any terminal state.
 */

const POLL_INTERVAL_MS = 2000;

/** ~2 minutes. Long enough for a cold encoder, short enough to give up cleanly. */
const MAX_POLLS = 60;

export interface UseDuplicateCheck {
  check: DuplicateCheckView | null;
  loading: boolean;
  /** True while a check is still running. */
  polling: boolean;
  error: string | null;
  /** Records that this report is the same issue as a candidate. */
  confirm: (candidateId: string) => Promise<void>;
  /** Records that the two reports are different. */
  reject: (candidateId: string) => Promise<void>;
  /** The candidate id currently being submitted, if any. */
  pendingCandidateId: string | null;
}

function isSettled(check: DuplicateCheckView | null): boolean {
  return check?.status === 'COMPLETED' || check?.status === 'FAILED';
}

export function useDuplicateCheck(
  publicId: string,
  initial: DuplicateCheckView | null = null,
): UseDuplicateCheck {
  const [check, setCheck] = useState<DuplicateCheckView | null>(initial);
  const [loading, setLoading] = useState(initial === null);
  const [error, setError] = useState<string | null>(null);
  const [pendingCandidateId, setPendingCandidateId] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const polls = useRef(0);

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
        const next = await fetchSimilar(publicId);
        if (cancelled) return;

        setCheck(next);
        setError(null);
        setLoading(false);
        polls.current += 1;

        if (!isSettled(next) && polls.current < MAX_POLLS) {
          timer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      } catch (caught) {
        if (cancelled) return;

        setLoading(false);
        // A failed poll is usually transient. Keep trying within the cap rather
        // than declaring the check dead on one network blip.
        polls.current += 1;

        if (polls.current >= MAX_POLLS) {
          setError(
            caught instanceof ApiError
              ? caught.message
              : 'Could not check for similar problems.',
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

  /**
   * Submits a verdict.
   *
   * The server returns the updated check, so the list reflects the decision
   * without a refetch — and without the client inventing what the new state
   * should be.
   */
  const submit = useCallback(
    async (
      candidateId: string,
      action: (publicId: string, candidateId: string) => Promise<DuplicateCheckView>,
      failureMessage: string,
    ) => {
      setPendingCandidateId(candidateId);
      setError(null);

      try {
        const next = await action(publicId, candidateId);
        clear();
        setCheck(next);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : failureMessage);
      } finally {
        setPendingCandidateId(null);
      }
    },
    [publicId, clear],
  );

  const confirm = useCallback(
    (candidateId: string) =>
      submit(candidateId, confirmDuplicate, 'Could not record your answer.'),
    [submit],
  );

  const reject = useCallback(
    (candidateId: string) =>
      submit(candidateId, rejectDuplicate, 'Could not record your answer.'),
    [submit],
  );

  return {
    check,
    loading,
    polling: !isSettled(check) && !error,
    error,
    confirm,
    reject,
    pendingCandidateId,
  };
}
