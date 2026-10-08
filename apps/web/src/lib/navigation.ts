import {
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  ClipboardCheck,
  Compass,
  FileText,
  Inbox,
  Gauge,
  LayoutDashboard,
  Map as MapIcon,
  MapPin,
  MessagesSquare,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Search,
  Target,
  Trophy,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '@samadhaan/shared';
import { governmentPath } from './government';
import { workspacePath } from './workspace';

/**
 * Navigation definition for the application shell.
 *
 * Declared as data rather than as JSX so the sidebar, the mobile bar and any
 * future command palette all read from one list — and so role-specific
 * navigation is a filter over this array, not a second component tree.
 *
 * `navigationFor()` is called with the signed-in user's role by the app shell,
 * so each role sees its own destinations. The citizen set is the default for an
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

const KNOWLEDGE_ITEM: NavItem = {
  href: '/knowledge',
  label: 'Knowledge',
  icon: BookOpen,
};

const NOTIFICATIONS_ITEM: NavItem = {
  href: '/notifications',
  label: 'Notifications',
  icon: Bell,
  badgeKey: 'notifications',
};

/**
 * `Explore` absorbed the old `Nearby` destination.
 *
 * They had become the same page: both answered "what has been reported around
 * me", from the same query, and two entries for one question is how a sidebar
 * starts feeling like a sitemap. Explore keeps the distance filter, so nothing
 * was lost.
 */
const CITIZEN_NAV: NavSection[] = [
  {
    id: 'primary',
    items: [
      { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
      { href: '/explore', label: 'Explore', icon: Compass },
      { href: '/map', label: 'Map', icon: MapIcon },
      { href: '/report', label: 'Report', icon: Plus },
      { href: '/my-problems', label: 'My reports', icon: FileText },
      { href: '/impact', label: 'My impact', icon: Sparkles },
      { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
      KNOWLEDGE_ITEM,
      NOTIFICATIONS_ITEM,
    ],
  },
];

/**
 * An organisation role outside any one workspace — before they have chosen
 * one, or when they belong to none yet. The workspace itself has its own
 * navigation, below.
 */
const ORGANIZATION_NAV: NavSection[] = [
  {
    id: 'primary',
    items: [
      { href: '/organization', label: 'Organisations', icon: Building2 },
      { href: '/explore', label: 'Explore', icon: Compass },
      { href: '/map', label: 'Map', icon: MapIcon },
      KNOWLEDGE_ITEM,
      NOTIFICATIONS_ITEM,
    ],
  },
];

/**
 * Navigation inside one organisation's workspace.
 *
 * Built from the slug, so every link stays inside the workspace being viewed.
 * The slug is an address, not a credential — each page asks the API, which
 * checks membership.
 */
export function workspaceNavigation(slug: string): NavSection[] {
  return [
    {
      id: 'workspace',
      items: [
        {
          href: workspacePath(slug, 'dashboard'),
          label: 'Dashboard',
          icon: LayoutDashboard,
        },
        { href: workspacePath(slug, 'problems'), label: 'Problems', icon: Search },
        {
          href: workspacePath(slug, 'opportunities'),
          label: 'Opportunities',
          icon: Target,
        },
        {
          href: workspacePath(slug, 'allocations'),
          label: 'Allocations',
          icon: Inbox,
        },
        {
          href: workspacePath(slug, 'analytics'),
          label: 'Analytics',
          icon: BarChart3,
        },
        { href: '/resolution', label: 'Resolution rooms', icon: MessagesSquare },
        KNOWLEDGE_ITEM,
        { href: workspacePath(slug, 'team'), label: 'Team', icon: Users },
        { href: workspacePath(slug, 'profile'), label: 'Organisation', icon: Building2 },
        { href: workspacePath(slug, 'settings'), label: 'Settings', icon: Settings },
        NOTIFICATIONS_ITEM,
      ],
    },
    {
      id: 'civic',
      label: 'Civic data',
      items: [
        { href: '/explore', label: 'Explore', icon: Compass },
        { href: '/map', label: 'Map', icon: MapIcon },
      ],
    },
  ];
}

/**
 * A government account outside any one office's portal — before choosing one,
 * or with no office yet. Inside a portal, `governmentNavigation` applies.
 */
const GOVERNMENT_NAV: NavSection[] = [
  {
    id: 'primary',
    items: [
      { href: '/government', label: 'Command centre', icon: Gauge },
      { href: '/explore', label: 'Explore', icon: Compass },
      KNOWLEDGE_ITEM,
      NOTIFICATIONS_ITEM,
    ],
  },
];

/** Navigation inside one government office's portal. */
export function governmentNavigation(slug: string): NavSection[] {
  return [
    {
      id: 'government',
      items: [
        { href: governmentPath(slug, 'dashboard'), label: 'Dashboard', icon: Gauge },
        {
          href: governmentPath(slug, 'problems'),
          label: 'Review queue',
          icon: ClipboardCheck,
        },
        { href: governmentPath(slug, 'map'), label: 'Map', icon: MapIcon },
        { href: governmentPath(slug, 'analytics'), label: 'Analytics', icon: BarChart3 },
        { href: '/resolution', label: 'Resolution rooms', icon: MessagesSquare },
        KNOWLEDGE_ITEM,
        NOTIFICATIONS_ITEM,
      ],
    },
    {
      id: 'civic',
      label: 'Civic data',
      items: [{ href: '/explore', label: 'Explore', icon: Compass }],
    },
  ];
}

export function governmentMobileNavigation(slug: string): MobileNavItem[] {
  return [
    { href: governmentPath(slug, 'dashboard'), label: 'Home', icon: Gauge },
    { href: governmentPath(slug, 'problems'), label: 'Review', icon: ClipboardCheck },
    { href: governmentPath(slug, 'map'), label: 'Map', icon: MapIcon },
    { href: '/notifications', label: 'Activity', icon: Bell, badgeKey: 'notifications' },
    { href: '/profile', label: 'Profile', icon: UserRound },
  ];
}

const ADMIN_NAV: NavSection[] = [
  {
    id: 'primary',
    items: [
      { href: '/admin', label: 'Overview', icon: Gauge },
      { href: '/admin/users', label: 'Users', icon: Users },
      { href: '/admin/organizations', label: 'Organisations', icon: Building2 },
      { href: '/admin/moderation', label: 'Moderation', icon: ShieldCheck },
      KNOWLEDGE_ITEM,
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
  { href: '/profile', label: 'Profile', icon: UserRound },
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
    { href: '/profile', label: 'Profile', icon: UserRound },
  ];
}

export const MOBILE_NAV: MobileNavItem[] = CITIZEN_MOBILE_NAV;

/**
 * The phone bar inside a workspace: the places a member goes daily.
 * Team, organisation profile and settings stay one tap away in the menu
 * drawer and on the dashboard.
 */
export function workspaceMobileNavigation(slug: string): MobileNavItem[] {
  return [
    { href: workspacePath(slug, 'dashboard'), label: 'Home', icon: LayoutDashboard },
    { href: workspacePath(slug, 'problems'), label: 'Problems', icon: Search },
    { href: workspacePath(slug, 'opportunities'), label: 'Opportunities', icon: Target },
    { href: workspacePath(slug, 'allocations'), label: 'Allocations', icon: Inbox },
    { href: '/notifications', label: 'Activity', icon: Bell, badgeKey: 'notifications' },
  ];
}

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
