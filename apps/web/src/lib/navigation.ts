import {
  Bell,
  Building2,
  ClipboardCheck,
  Compass,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  MapPin,
  Settings,
  ShieldCheck,
  Target,
  TrendingUp,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '@samadhaan/shared';

/**
 * Navigation definition for the application shell.
 *
 * Declared as data rather than as JSX so the sidebar, the mobile bar and any
 * future command palette all read from one list — and so role-specific
 * navigation is a filter over this array, not a second component tree.
 *
 * `roles` is already on every item but nothing filters by it yet: the auth
 * milestone supplies the signed-in role and turns `navigationFor()` on. Until
 * then the citizen set renders, which is the correct default for an
 * unauthenticated visitor.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Roles that see this item. Omit to show it to everyone. */
  roles?: UserRole[];
  /** Renders an unread count. Wired to real data in a later milestone. */
  badgeKey?: 'notifications';
}

export interface NavSection {
  id: string;
  /** Section heading. Omit for the primary, unlabelled group. */
  label?: string;
  items: NavItem[];
}

const NOTIFICATIONS_ITEM: NavItem = {
  href: '/notifications',
  label: 'Notifications',
  icon: Bell,
  badgeKey: 'notifications',
};

const CITIZEN_NAV: NavSection[] = [
  {
    id: 'primary',
    items: [
      { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
      { href: '/explore', label: 'Explore', icon: Compass },
      { href: '/nearby', label: 'Nearby', icon: MapPin },
      { href: '/my-problems', label: 'My problems', icon: MapPin },
      { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
      NOTIFICATIONS_ITEM,
    ],
  },
];

/** NGO, university and industry share one workspace. */
const ORGANIZATION_NAV: NavSection[] = [
  {
    id: 'primary',
    items: [
      { href: '/organization', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/organization/opportunities', label: 'Opportunities', icon: Target },
      { href: '/organization/projects', label: 'Projects', icon: FolderKanban },
      { href: '/explore', label: 'Explore', icon: Compass },
      NOTIFICATIONS_ITEM,
    ],
  },
];

const GOVERNMENT_NAV: NavSection[] = [
  {
    id: 'primary',
    items: [
      { href: '/government', label: 'Command centre', icon: Gauge },
      { href: '/government/problems', label: 'Problems', icon: MapPin },
      { href: '/government/allocations', label: 'Allocations', icon: ClipboardCheck },
      { href: '/government/verification', label: 'Verification', icon: ShieldCheck },
      { href: '/government/analytics', label: 'Analytics', icon: TrendingUp },
      NOTIFICATIONS_ITEM,
    ],
  },
];

const ADMIN_NAV: NavSection[] = [
  {
    id: 'primary',
    items: [
      { href: '/admin', label: 'Overview', icon: Gauge },
      { href: '/admin/users', label: 'Users', icon: Users },
      { href: '/admin/organizations', label: 'Organisations', icon: Building2 },
      { href: '/admin/moderation', label: 'Moderation', icon: ShieldCheck },
      NOTIFICATIONS_ITEM,
    ],
  },
];

/** One navigation set per role. */
const NAV_BY_ROLE: Record<UserRole, NavSection[]> = {
  CITIZEN: CITIZEN_NAV,
  NGO: ORGANIZATION_NAV,
  UNIVERSITY: ORGANIZATION_NAV,
  INDUSTRY: ORGANIZATION_NAV,
  GOVERNMENT: GOVERNMENT_NAV,
  ADMIN: ADMIN_NAV,
};

/** Pinned to the bottom of the sidebar, away from the primary destinations. */
export const SECONDARY_NAV: NavItem[] = [
  { href: '/settings', label: 'Settings', icon: Settings },
];

/**
 * Navigation for a role.
 *
 * The shell calls this with the signed-in user's role and renders whatever it
 * returns, so adding a role's workspace is a change to the table above and
 * nothing else.
 */
export function navigationFor(role: UserRole = 'CITIZEN'): NavSection[] {
  return (NAV_BY_ROLE[role] ?? CITIZEN_NAV)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.roles || item.roles.includes(role)),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * Mobile bottom bar.
 *
 * Deliberately not the sidebar list: a phone bar holds five targets, and
 * "Report" is promoted into the centre because reporting from the street is
 * the workflow the product exists for.
 */
export interface MobileNavItem extends NavItem {
  /** Renders as the raised centre action. */
  primary?: boolean;
}

const CITIZEN_MOBILE_NAV: MobileNavItem[] = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/explore', label: 'Explore', icon: Compass },
  { href: '/report', label: 'Report', icon: MapPin, primary: true },
  { href: '/notifications', label: 'Activity', icon: Bell, badgeKey: 'notifications' },
  { href: '/profile', label: 'Profile', icon: Settings },
];

/**
 * Non-citizen roles get no raised Report action — they triage and resolve
 * problems rather than reporting them, so promoting it would be wrong.
 */
function workspaceMobileNav(home: string): MobileNavItem[] {
  return [
    { href: home, label: 'Home', icon: LayoutDashboard },
    { href: '/explore', label: 'Explore', icon: Compass },
    { href: '/notifications', label: 'Activity', icon: Bell, badgeKey: 'notifications' },
    { href: '/profile', label: 'Profile', icon: Settings },
  ];
}

export const MOBILE_NAV: MobileNavItem[] = CITIZEN_MOBILE_NAV;

export function mobileNavigationFor(role: UserRole = 'CITIZEN'): MobileNavItem[] {
  if (role === 'CITIZEN') return CITIZEN_MOBILE_NAV;
  if (role === 'GOVERNMENT') return workspaceMobileNav('/government');
  if (role === 'ADMIN') return workspaceMobileNav('/admin');
  return workspaceMobileNav('/organization');
}

/**
 * Whether a nav item should render as current.
 *
 * Matches the segment rather than the exact string so `/problems/SAM-1023`
 * still highlights its parent, while `/` never matches everything.
 */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
