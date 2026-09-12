import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { requireUser } from '@/lib/auth-server';
import { NOTIFICATIONS } from '@/data/activity';

/**
 * Authenticated application layout.
 *
 * `requireUser()` is the authoritative check for this route group: it calls the
 * API, which verifies the token signature and confirms the session row still
 * exists, then redirects to sign-in if not. `proxy.ts` also bounces obvious
 * cases at the edge, but that is only an optimisation — a forged cookie gets
 * past it and fails here.
 *
 * Notifications remain fixtures until that milestone lands.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <AppShell user={user} notifications={NOTIFICATIONS}>
      {children}
    </AppShell>
  );
}
