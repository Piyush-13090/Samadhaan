'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ROLE_HOME_ROUTE, type AuthenticatedUser } from '@samadhaan/shared';
import { ApiError } from '@/lib/api-error';
import * as authService from '@/services/auth.service';

/**
 * The single source of authentication state in the browser.
 *
 * It holds the *user*, never a token. Tokens live in httpOnly cookies the
 * browser attaches automatically and JavaScript cannot read — which is the
 * whole point: an XSS hole can call the API as the user while the page is open,
 * but it cannot steal a credential and replay it later from somewhere else.
 *
 * The provider is seeded with the user resolved during server rendering, so the
 * first paint already knows whether someone is signed in. Without that the UI
 * would flash a signed-out shell on every load.
 */

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  status: AuthStatus;
  /** True while a sign-in, registration or sign-out request is in flight. */
  pending: boolean;
  login: (email: string, password: string) => Promise<AuthenticatedUser>;
  register: (input: authService.RegisterInput) => Promise<AuthenticatedUser>;
  logout: () => Promise<void>;
  /** Re-reads the session from the API, e.g. after a profile update. */
  refresh: () => Promise<void>;
  /** Replaces the cached user without a round trip. */
  setUser: (user: AuthenticatedUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an <AuthProvider>');
  return context;
}

/** Convenience for components that only render for signed-in users. */
export function useCurrentUser(): AuthenticatedUser | null {
  return useAuth().user;
}

/**
 * Schedules a silent token refresh slightly before the access token expires.
 *
 * Refreshing at 80% of the lifetime leaves margin for a slow request, so an
 * active user's session is renewed without them ever meeting a 401.
 */
const REFRESH_AT_FRACTION = 0.8;

export function AuthProvider({
  children,
  initialUser,
}: {
  children: ReactNode;
  /** Resolved on the server so the first render is already correct. */
  initialUser: AuthenticatedUser | null;
}) {
  const router = useRouter();
  const [user, setUserState] = useState<AuthenticatedUser | null>(initialUser);
  const [status, setStatus] = useState<AuthStatus>(
    initialUser ? 'authenticated' : 'unauthenticated',
  );
  const [pending, setPending] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  /**
   * Holds the latest `applySession` so the scheduled refresh can re-schedule
   * itself. Recursing through the closure directly would capture whichever
   * version existed when the timer was set, and every later renewal would keep
   * using that stale one.
   */
  const applySessionRef = useRef<
    ((user: AuthenticatedUser, expiresIn: number) => void) | null
  >(null);

  const applySession = useCallback(
    (nextUser: AuthenticatedUser, expiresIn: number) => {
      setUserState(nextUser);
      setStatus('authenticated');

      clearTimer();
      refreshTimer.current = setTimeout(
        () => {
          void authService
            .refreshSession()
            .then((session) => applySessionRef.current?.(session.user, session.expiresIn))
            .catch(() => {
              // The refresh token is gone or revoked — the session is over.
              setUserState(null);
              setStatus('unauthenticated');
            });
        },
        Math.max(expiresIn * REFRESH_AT_FRACTION, 30) * 1000,
      );
    },
    [clearTimer],
  );

  useEffect(() => {
    applySessionRef.current = applySession;
  }, [applySession]);

  // Start the refresh cycle for a session that began on the server.
  useEffect(() => {
    if (!initialUser) return;

    void authService
      .refreshSession()
      .then((session) => applySession(session.user, session.expiresIn))
      .catch(() => {
        // Refresh failing at mount means the cookie is stale; the server said
        // otherwise, so trust the server for this render and let the next
        // navigation settle it.
      });

    return clearTimer;
  }, [initialUser, applySession, clearTimer]);

  const login = useCallback(
    async (email: string, password: string) => {
      setPending(true);
      try {
        const session = await authService.login({ email, password });
        applySession(session.user, session.expiresIn);
        // Re-run server components so the shell renders with the new session.
        router.refresh();
        return session.user;
      } finally {
        setPending(false);
      }
    },
    [applySession, router],
  );

  const register = useCallback(
    async (input: authService.RegisterInput) => {
      setPending(true);
      try {
        const session = await authService.register(input);
        applySession(session.user, session.expiresIn);
        router.refresh();
        return session.user;
      } finally {
        setPending(false);
      }
    },
    [applySession, router],
  );

  const logout = useCallback(async () => {
    setPending(true);
    try {
      await authService.logout();
    } catch {
      // The server may already consider the session gone. Either way the local
      // state must be cleared — refusing to sign out because the request failed
      // would strand the user in a signed-in UI they cannot leave.
    } finally {
      clearTimer();
      setUserState(null);
      setStatus('unauthenticated');
      setPending(false);
      router.replace('/');
      router.refresh();
    }
  }, [clearTimer, router]);

  const refresh = useCallback(async () => {
    try {
      setUserState(await authService.fetchCurrentUser());
      setStatus('authenticated');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUserState(null);
        setStatus('unauthenticated');
        return;
      }
      throw error;
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      pending,
      login,
      register,
      logout,
      refresh,
      setUser: setUserState,
    }),
    [user, status, pending, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Where a user should land after signing in. */
export function homeRouteFor(user: AuthenticatedUser): string {
  return ROLE_HOME_ROUTE[user.role];
}
