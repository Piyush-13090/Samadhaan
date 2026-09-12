import type { AuthenticatedUser } from '@samadhaan/shared';
import type { User } from '../generated/prisma/client.js';

/**
 * Converts a database row into the only user shape allowed over the network.
 *
 * This is an explicit allow-list, not a delete-list. Spreading the row and
 * removing `passwordHash` would mean every future column is exposed by default
 * and one schema change away from leaking; here a new column is invisible until
 * someone deliberately adds it.
 *
 * Every handler that returns a user goes through this function. That is what
 * makes "we never return password hashes" a property of the system rather than
 * a habit.
 */
export function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
  };
}
