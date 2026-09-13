import type {
  OrganizationActivity,
  OrganizationExpertiseEntry,
  OrganizationMemberSummary,
  OwnProfile,
  ProfileActivity,
  PublicOrganization,
  PublicProfile,
} from '@samadhaan/shared';
import { api, createServerApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

/**
 * Profile and organisation calls.
 *
 * Browser calls use the shared client (same-origin, cookies attached
 * automatically). Server components pass the incoming request's cookie header
 * explicitly, because there is no browser cookie jar on the server.
 */

// --- Users -----------------------------------------------------------------

export function fetchOwnProfile(): Promise<OwnProfile> {
  return api.get<OwnProfile>('/users/me', { cache: 'no-store' });
}

export function fetchOwnActivity(): Promise<ProfileActivity> {
  return api.get<ProfileActivity>('/users/me/activity', { cache: 'no-store' });
}

export interface ProfileUpdateInput {
  fullName?: string;
  displayName?: string;
  bio?: string | null;
  avatarUrl?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  phone?: string | null;
}

export function updateOwnProfile(input: ProfileUpdateInput): Promise<OwnProfile> {
  return api.patch<OwnProfile>('/users/me', input);
}

/** Own profile plus activity, resolved during server rendering. */
export async function fetchOwnProfileOnServer(
  cookieHeader: string,
): Promise<{ profile: OwnProfile; activity: ProfileActivity } | null> {
  if (!cookieHeader) return null;

  const server = createServerApi();
  const options = { cache: 'no-store' as const, headers: { cookie: cookieHeader } };

  try {
    const [profile, activity] = await Promise.all([
      server.get<OwnProfile>('/users/me', options),
      server.get<ProfileActivity>('/users/me/activity', options),
    ]);

    return { profile, activity };
  } catch (error) {
    // Not signed in is an expected state, not a page failure.
    if (error instanceof ApiError) return null;
    throw error;
  }
}

export async function fetchPublicProfileOnServer(
  displayName: string,
  cookieHeader: string,
): Promise<{ profile: PublicProfile; activity: ProfileActivity } | null> {
  try {
    return await createServerApi().get<{
      profile: PublicProfile;
      activity: ProfileActivity;
    }>(`/users/by-handle/${encodeURIComponent(displayName)}`, {
      cache: 'no-store',
      headers: cookieHeader ? { cookie: cookieHeader } : ({} as Record<string, string>),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

// --- Organisations ---------------------------------------------------------

export interface OrganizationPageData {
  organization: PublicOrganization;
  members: OrganizationMemberSummary[];
  activity: OrganizationActivity;
}

/**
 * Everything an organisation profile page renders.
 *
 * The cookie header is forwarded so the API can resolve the viewer and return
 * `viewerPermissions` — that is what lets the page show edit controls to owners
 * and a read-only view to everyone else. The permissions are a mirror of the
 * server's decision, never the decision itself.
 *
 * Returns `null` for an unknown slug so the page can render `notFound()`.
 */
export async function fetchOrganizationPage(
  slug: string,
  cookieHeader: string,
): Promise<OrganizationPageData | null> {
  const server = createServerApi();
  const options = {
    cache: 'no-store' as const,
    headers: cookieHeader ? { cookie: cookieHeader } : ({} as Record<string, string>),
  };

  try {
    const organization = await server.get<PublicOrganization>(
      `/organizations/${encodeURIComponent(slug)}`,
      options,
    );

    // Members and activity need the id, so they follow the profile read.
    const [members, activity] = await Promise.all([
      server.get<OrganizationMemberSummary[]>(
        `/organizations/${organization.id}/members`,
        options,
      ),
      server.get<OrganizationActivity>(
        `/organizations/${organization.id}/activity`,
        options,
      ),
    ]);

    return { organization, members, activity };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function updateOrganization(
  organizationId: string,
  input: Record<string, unknown>,
): Promise<PublicOrganization> {
  return api.patch<PublicOrganization>(`/organizations/${organizationId}`, input);
}

export function addExpertise(
  organizationId: string,
  input: { category: string; subcategory?: string | null; level?: string },
): Promise<OrganizationExpertiseEntry> {
  return api.post<OrganizationExpertiseEntry>(
    `/organizations/${organizationId}/expertise`,
    input,
  );
}

export function removeExpertise(
  organizationId: string,
  expertiseId: string,
): Promise<void> {
  return api.delete<void>(`/organizations/${organizationId}/expertise/${expertiseId}`);
}
