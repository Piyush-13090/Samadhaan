import {
  ROLE_HOME_ROUTE,
  isOrganizationRole,
  type MyOrganizations,
  type GovernmentWorkspaceSummary,
  type UserRole,
  type WorkspaceSummary,
} from '@samadhaan/shared';
import { governmentPath, governmentSlugFromPath } from './government';
import {
  governmentMobileNavigation,
  governmentNavigation,
  mobileNavigationFor,
  navigationFor,
  workspaceMobileNavigation,
  workspaceNavigation,
  type MobileNavItem,
  type NavSection,
} from './navigation';
import { workspacePath, workspaceSlugFromPath } from './workspace';

/**
 * Which workspace the application shell is showing, and its navigation.
 *
 * A pure function of the role, the path, the user's memberships and the last
 * workspace they used — so it can be tested without rendering, and the
 * sidebar, phone bar and drawer cannot disagree.
 *
 * None of this is authorisation. Choosing a workspace here only decides which
 * links are drawn; every page asks the API, which checks membership.
 */
export interface ShellContext {
  /** The workspace in view, or null for a role's own navigation. */
  workspaceSlug: string | null;
  /** Its summary, when the user's membership list contains it. */
  workspace: WorkspaceSummary | null;
  sections: NavSection[];
  mobileItems: MobileNavItem[];
  /** Where the logo goes. */
  homeHref: string;
  /**
   * Whether to offer a context switcher: more than one place to be, counting
   * the citizen's personal space.
   */
  canSwitch: boolean;
  /** A citizen's own space, offered in the switcher beside their workspaces. */
  personal: { href: string; label: string } | null;
}

export function resolveShellContext({
  role,
  pathname,
  organizations,
  rememberedSlug,
  governmentOffices = [],
}: {
  role: UserRole;
  pathname: string;
  organizations: MyOrganizations;
  rememberedSlug: string | null;
  /** A government official's offices, for the portal navigation. */
  governmentOffices?: GovernmentWorkspaceSummary[];
}): ShellContext {
  if (role === 'GOVERNMENT') {
    const slug =
      governmentSlugFromPath(pathname) ??
      governmentOffices.find((office) => office.isAccessible)?.slug ??
      null;
    return {
      workspaceSlug: null,
      workspace: null,
      sections: slug ? governmentNavigation(slug) : navigationFor(role),
      mobileItems: slug ? governmentMobileNavigation(slug) : mobileNavigationFor(role),
      homeHref: slug ? governmentPath(slug) : ROLE_HOME_ROUTE.GOVERNMENT,
      canSwitch: false,
      personal: null,
    };
  }

  const { workspaces } = organizations;
  const accessible = workspaces.filter((workspace) => workspace.isAccessible);

  let slug = workspaceSlugFromPath(pathname);

  // An organisation account outside a workspace page (notifications, the map)
  // keeps the workspace it was last in, so its navigation does not change
  // underneath it.
  if (!slug && isOrganizationRole(role)) {
    slug =
      accessible.find((workspace) => workspace.slug === rememberedSlug)?.slug ??
      accessible[0]?.slug ??
      null;
  }

  // Only a citizen has a personal space of their own to switch back to. The
  // other roles' home is their workspace.
  const personal =
    role === 'CITIZEN' && workspaces.length > 0
      ? { href: ROLE_HOME_ROUTE.CITIZEN, label: 'Personal' }
      : null;

  const canSwitch = workspaces.length + (personal ? 1 : 0) > 1;

  if (slug) {
    return {
      workspaceSlug: slug,
      workspace: workspaces.find((workspace) => workspace.slug === slug) ?? null,
      sections: workspaceNavigation(slug),
      mobileItems: workspaceMobileNavigation(slug),
      homeHref: workspacePath(slug),
      canSwitch,
      personal,
    };
  }

  return {
    workspaceSlug: null,
    workspace: null,
    sections: navigationFor(role),
    mobileItems: mobileNavigationFor(role),
    homeHref: ROLE_HOME_ROUTE[role],
    canSwitch,
    personal,
  };
}
