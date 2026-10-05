'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ProblemEngagement } from '@samadhaan/shared';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import {
  followProblem,
  supportProblem,
  unfollowProblem,
  withdrawSupport,
} from '@/services/community.service';

/**
 * Community engagement state for one problem page.
 *
 * Shared through context because two separated parts of the page read it — the
 * header shows the counts and the toggles, the discussion moves the comment
 * count — and the server-rendered layout between them must not become client
 * code just to pass props through.
 *
 * **Optimistic, then corrected by the server.** A tap updates immediately, then
 * the response replaces the guess with the server's own count. On failure the
 * previous state is restored and a toast says what happened. The UI never sends
 * a count; it only displays the last one the server returned.
 */

type Action = 'support' | 'follow';

interface EngagementContextValue {
  publicId: string;
  engagement: ProblemEngagement;
  pending: Record<Action, boolean>;
  /** A short sentence for the polite live region after each change. */
  announcement: string;
  toggleSupport: () => Promise<void>;
  toggleFollow: () => Promise<void>;
  /** The discussion reports the server's comment count after each write. */
  setCommentCount: (count: number) => void;
}

const EngagementContext = createContext<EngagementContextValue | null>(null);

export function useEngagement(): EngagementContextValue {
  const context = useContext(EngagementContext);
  if (!context) throw new Error('useEngagement must be used within <EngagementProvider>');
  return context;
}

/** For components that render with or without a provider, such as the discussion in tests. */
export function useOptionalEngagement(): EngagementContextValue | null {
  return useContext(EngagementContext);
}

export function EngagementProvider({
  publicId,
  initial,
  children,
}: {
  publicId: string;
  initial: ProblemEngagement;
  children: ReactNode;
}) {
  const { toast } = useToast();
  const [engagement, setEngagement] = useState(initial);
  const [pending, setPending] = useState<Record<Action, boolean>>({
    support: false,
    follow: false,
  });
  const [announcement, setAnnouncement] = useState('');

  // A ref, not state: a double tap must see the flag the first tap set, not the
  // value captured when its handler was created.
  const inFlight = useRef<Record<Action, boolean>>({ support: false, follow: false });

  const fail = useCallback(
    (error: unknown, action: Action) => {
      const message =
        error instanceof ApiError
          ? error.status === 401
            ? 'Your session has expired. Please sign in again.'
            : error.message
          : 'Check your connection and try again.';

      toast({
        tone: 'danger',
        title:
          action === 'support'
            ? "Couldn't update your support"
            : "Couldn't update follow",
        description: message,
      });
    },
    [toast],
  );

  const toggleSupport = useCallback(async () => {
    if (inFlight.current.support) return;
    inFlight.current.support = true;

    const previous = engagement;
    const supporting = !previous.supportedByCurrentUser;

    setPending((state) => ({ ...state, support: true }));
    setEngagement({
      ...previous,
      supportedByCurrentUser: supporting,
      supportCount: Math.max(0, previous.supportCount + (supporting ? 1 : -1)),
    });

    try {
      const result = supporting
        ? await supportProblem(publicId)
        : await withdrawSupport(publicId);

      setEngagement((state) => ({ ...state, ...result }));
      setAnnouncement(
        result.supportedByCurrentUser
          ? `You support this problem. ${plural(result.supportCount, 'supporter')}.`
          : `Support removed. ${plural(result.supportCount, 'supporter')}.`,
      );
    } catch (error) {
      setEngagement((state) => ({
        ...state,
        supportedByCurrentUser: previous.supportedByCurrentUser,
        supportCount: previous.supportCount,
      }));
      fail(error, 'support');
    } finally {
      inFlight.current.support = false;
      setPending((state) => ({ ...state, support: false }));
    }
  }, [publicId, engagement, fail]);

  const toggleFollow = useCallback(async () => {
    if (inFlight.current.follow) return;
    inFlight.current.follow = true;

    const previous = engagement;
    const following = !previous.followedByCurrentUser;

    setPending((state) => ({ ...state, follow: true }));
    setEngagement({
      ...previous,
      followedByCurrentUser: following,
      followerCount: Math.max(0, previous.followerCount + (following ? 1 : -1)),
    });

    try {
      const result = following
        ? await followProblem(publicId)
        : await unfollowProblem(publicId);

      setEngagement((state) => ({ ...state, ...result }));
      setAnnouncement(
        result.followedByCurrentUser
          ? 'You are following this problem.'
          : 'You are no longer following this problem.',
      );
    } catch (error) {
      setEngagement((state) => ({
        ...state,
        followedByCurrentUser: previous.followedByCurrentUser,
        followerCount: previous.followerCount,
      }));
      fail(error, 'follow');
    } finally {
      inFlight.current.follow = false;
      setPending((state) => ({ ...state, follow: false }));
    }
  }, [publicId, engagement, fail]);

  const setCommentCount = useCallback((count: number) => {
    setEngagement((state) => ({ ...state, commentCount: count }));
  }, []);

  const value = useMemo(
    () => ({
      publicId,
      engagement,
      pending,
      announcement,
      toggleSupport,
      toggleFollow,
      setCommentCount,
    }),
    [
      publicId,
      engagement,
      pending,
      announcement,
      toggleSupport,
      toggleFollow,
      setCommentCount,
    ],
  );

  return (
    <EngagementContext.Provider value={value}>{children}</EngagementContext.Provider>
  );
}

export function plural(count: number, noun: string): string {
  return `${count.toLocaleString('en-IN')} ${count === 1 ? noun : `${noun}s`}`;
}
