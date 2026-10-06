import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { requireUser } from '@/lib/auth-server';
import { requestCookieHeader } from '@/lib/request-cookies';
import { fetchGovernmentOfficesOnServer } from '@/services/government.service';
import { fetchMyOrganizationsOnServer } from '@/services/workspace.service';

/**
 * Authenticated application layout.
 *
 * `requireUser()` is the authoritative check for this route group: it calls the
 * API, which verifies the token signature and confirms the session row still
 * exists, then redirects to sign-in if not. `proxy.ts` also bounces obvious
 * cases at the edge, but that is only an optimisation — a forged cookie gets
 * past it and fails here.
 *
 * The user's organisation memberships are loaded once here for the shell's
 * workspace switcher. Layouts do not re-render on navigation, so anything that
 * changes membership (accepting an invitation) calls `router.refresh()`.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const cookieHeader = await requestCookieHeader();
  const [organizations, governmentOffices] = await Promise.all([
    fetchMyOrganizationsOnServer(cookieHeader),
    // Only an official has offices; nobody else pays for the request.
    user.role === 'GOVERNMENT'
      ? fetchGovernmentOfficesOnServer(cookieHeader)
      : Promise.resolve([]),
  ]);

  return (
    <AppShell
      user={user}
      organizations={organizations}
      governmentOffices={governmentOffices}
    >
      {children}
    </AppShell>
  );
}
