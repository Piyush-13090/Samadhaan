import type { UserRole } from '@samadhaan/shared';

/**
 * How roles are named in the interface.
 *
 * Centralised so "Government" is worded identically in the account menu, the
 * profile page and any future admin table — and so renaming one is a one-line
 * change rather than a search across components.
 */
export const ROLE_LABEL: Record<UserRole, string> = {
  CITIZEN: 'Citizen',
  NGO: 'NGO partner',
  UNIVERSITY: 'University partner',
  INDUSTRY: 'Industry partner',
  GOVERNMENT: 'Government',
  ADMIN: 'Administrator',
};

/** One-line description of what the role can do, for the profile page. */
export const ROLE_DESCRIPTION: Record<UserRole, string> = {
  CITIZEN: 'Report problems, support others, and suggest solutions.',
  NGO: 'Discover problems, take them on, and report progress.',
  UNIVERSITY: 'Source civic problems for research and student projects.',
  INDUSTRY: 'Direct resources at problems with verified impact.',
  GOVERNMENT: 'Review, allocate and verify the resolution of problems.',
  ADMIN: 'Administer the platform, its users and its organisations.',
};
