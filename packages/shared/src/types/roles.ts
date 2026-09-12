/**
 * Platform roles. Mirrors the `UserRole` enum in the Prisma schema.
 * Kept in sync manually so the frontend does not need a Prisma dependency.
 */
export const USER_ROLES = [
  'CITIZEN',
  'NGO',
  'UNIVERSITY',
  'INDUSTRY',
  'GOVERNMENT',
  'ADMIN',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Roles that represent an organisation rather than an individual. */
export const ORGANIZATION_ROLES = ['NGO', 'UNIVERSITY', 'INDUSTRY'] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return (
    typeof value === 'string' && (ORGANIZATION_ROLES as readonly string[]).includes(value)
  );
}

/** Account lifecycle state. Mirrors the `UserStatus` enum in the Prisma schema. */
export const USER_STATUSES = ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED'] as const;

export type UserStatus = (typeof USER_STATUSES)[number];
