import { describe, expect, it } from 'vitest';
import type { MyOrganizations, WorkspaceSummary } from '@samadhaan/shared';
import { resolveShellContext } from './shell-context';

function workspace(
  slug: string,
  overrides: Partial<WorkspaceSummary> = {},
): WorkspaceSummary {
  return {
    organizationId: `id-${slug}`,
    slug,
    name: slug,
    type: 'NGO',
    logoUrl: null,
    verificationStatus: 'VERIFIED',
    membershipRole: 'MEMBER',
    isAccessible: true,
    ...overrides,
  };
}

const none: MyOrganizations = { workspaces: [], invitations: [] };
const hrefs = (context: ReturnType<typeof resolveShellContext>) =>
  context.sections.flatMap((section) => section.items.map((item) => item.href));

describe('resolveShellContext', () => {
  it('leaves a citizen with no memberships on the citizen navigation, unswitchable', () => {
    const context = resolveShellContext({
      role: 'CITIZEN',
      pathname: '/dashboard',
      organizations: none,
      rememberedSlug: null,
    });

    expect(context.workspaceSlug).toBeNull();
    expect(hrefs(context)).toContain('/report');
    expect(context.canSwitch).toBe(false);
    expect(context.personal).toBeNull();
    expect(context.homeHref).toBe('/dashboard');
  });

  it('gives a single-organisation member their workspace, with no switcher', () => {
    const context = resolveShellContext({
      role: 'NGO',
      pathname: '/notifications',
      organizations: { workspaces: [workspace('clean-city')], invitations: [] },
      rememberedSlug: null,
    });

    expect(context.workspaceSlug).toBe('clean-city');
    expect(context.homeHref).toBe('/organization/clean-city/dashboard');
    expect(hrefs(context)).toEqual(
      expect.arrayContaining([
        '/organization/clean-city/dashboard',
        '/organization/clean-city/problems',
        '/organization/clean-city/opportunities',
        '/organization/clean-city/team',
        '/organization/clean-city/profile',
        '/organization/clean-city/settings',
        '/notifications',
      ]),
    );
    expect(context.canSwitch).toBe(false);
  });

  it('follows the workspace in the path', () => {
    const context = resolveShellContext({
      role: 'UNIVERSITY',
      pathname: '/organization/institute/team',
      organizations: {
        workspaces: [
          workspace('clean-city'),
          workspace('institute', { type: 'UNIVERSITY' }),
        ],
        invitations: [],
      },
      rememberedSlug: 'clean-city',
    });

    expect(context.workspaceSlug).toBe('institute');
    expect(context.workspace?.type).toBe('UNIVERSITY');
    expect(context.canSwitch).toBe(true);
  });

  it('keeps the last workspace outside workspace pages', () => {
    const context = resolveShellContext({
      role: 'UNIVERSITY',
      pathname: '/map',
      organizations: {
        workspaces: [workspace('clean-city'), workspace('institute')],
        invitations: [],
      },
      rememberedSlug: 'institute',
    });

    expect(context.workspaceSlug).toBe('institute');
  });

  it('never defaults to a suspended workspace, or a remembered one the user left', () => {
    const context = resolveShellContext({
      role: 'NGO',
      pathname: '/notifications',
      organizations: {
        workspaces: [workspace('closed', { isAccessible: false }), workspace('open')],
        invitations: [],
      },
      rememberedSlug: 'gone',
    });

    expect(context.workspaceSlug).toBe('open');
  });

  it('falls back to the organisation chooser when there is no workspace', () => {
    const context = resolveShellContext({
      role: 'INDUSTRY',
      pathname: '/notifications',
      organizations: none,
      rememberedSlug: null,
    });

    expect(context.workspaceSlug).toBeNull();
    expect(hrefs(context)).toContain('/organization');
    // No dead links to workspace sections that do not exist.
    expect(hrefs(context).some((href) => href.startsWith('/organization/'))).toBe(false);
  });

  it('lets a citizen who belongs to an organisation switch between the two', () => {
    const outside = resolveShellContext({
      role: 'CITIZEN',
      pathname: '/dashboard',
      organizations: { workspaces: [workspace('clean-city')], invitations: [] },
      rememberedSlug: 'clean-city',
    });

    // Outside a workspace a citizen keeps their own navigation…
    expect(outside.workspaceSlug).toBeNull();
    expect(hrefs(outside)).toContain('/report');
    // …and can switch.
    expect(outside.canSwitch).toBe(true);
    expect(outside.personal).toEqual({ href: '/dashboard', label: 'Personal' });

    const inside = resolveShellContext({
      role: 'CITIZEN',
      pathname: '/organization/clean-city/dashboard',
      organizations: { workspaces: [workspace('clean-city')], invitations: [] },
      rememberedSlug: null,
    });
    expect(inside.workspaceSlug).toBe('clean-city');
  });

  it('gives the phone bar the workspace destinations', () => {
    const context = resolveShellContext({
      role: 'NGO',
      pathname: '/organization/clean-city/dashboard',
      organizations: { workspaces: [workspace('clean-city')], invitations: [] },
      rememberedSlug: null,
    });

    expect(context.mobileItems.map((item) => item.label)).toEqual([
      'Home',
      'Problems',
      'Opportunities',
      'Allocations',
      'Activity',
    ]);
    expect(context.mobileItems.some((item) => item.primary)).toBe(false);
  });

  it('gives an official their office portal, with no dead links', () => {
    const context = resolveShellContext({
      role: 'GOVERNMENT',
      pathname: '/notifications',
      organizations: none,
      rememberedSlug: null,
      governmentOffices: [
        {
          organizationId: 'g',
          slug: 'gurgaon-mc',
          name: 'Gurgaon MC',
          jurisdictionType: 'MUNICIPAL_CORPORATION',
          jurisdictionName: 'Gurgaon',
          membershipRole: 'MEMBER',
          isAccessible: true,
        },
      ],
    });

    expect(hrefs(context)).toEqual(
      expect.arrayContaining([
        '/government/gurgaon-mc/dashboard',
        '/government/gurgaon-mc/problems',
        '/government/gurgaon-mc/map',
        '/government/gurgaon-mc/analytics',
        '/notifications',
      ]),
    );
    // Allocation and verification are reached from a problem, not the menu.
    expect(hrefs(context).some((href) => /allocations|verification/.test(href))).toBe(
      false,
    );
    expect(context.homeHref).toBe('/government/gurgaon-mc/dashboard');
    expect(context.mobileItems.map((item) => item.label)).toEqual([
      'Home',
      'Review',
      'Map',
      'Activity',
      'Profile',
    ]);
  });

  it('follows the office in the path', () => {
    const context = resolveShellContext({
      role: 'GOVERNMENT',
      pathname: '/government/jaipur-mc/problems',
      organizations: none,
      rememberedSlug: null,
    });
    expect(context.homeHref).toBe('/government/jaipur-mc/dashboard');
  });

  it('leaves government navigation untouched', () => {
    const context = resolveShellContext({
      role: 'GOVERNMENT',
      pathname: '/government',
      organizations: none,
      rememberedSlug: null,
    });

    expect(hrefs(context)).toContain('/government');
    expect(context.workspaceSlug).toBeNull();
  });
});
