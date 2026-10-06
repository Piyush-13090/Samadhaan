import type { Prisma } from '../generated/prisma/client.js';

/** Organisation actions that leave an audit entry. */
export type OrganizationAuditAction =
  | 'ORGANIZATION_PROFILE_UPDATED'
  | 'ORGANIZATION_EXPERTISE_SET'
  | 'ORGANIZATION_EXPERTISE_REMOVED'
  | 'ORGANIZATION_MEMBER_INVITED'
  | 'ORGANIZATION_INVITATION_ACCEPTED'
  | 'ORGANIZATION_INVITATION_DECLINED'
  | 'ORGANIZATION_INVITATION_WITHDRAWN'
  | 'ORGANIZATION_MEMBER_ROLE_CHANGED'
  | 'ORGANIZATION_MEMBER_REMOVED'
  | 'ORGANIZATION_RECOMMENDATION_DISMISSED'
  | 'ORGANIZATION_RECOMMENDATION_RESTORED';

/**
 * Writes an organisation audit entry.
 *
 * Takes the caller's transaction where there is one, so the entry commits or
 * rolls back with the change it describes — an audit row for a change that
 * never happened is as misleading as a change with no row.
 *
 * `metadata` carries ids, roles and field *names*. Never values that may be
 * personal data (emails, phone numbers) and never anything credential-like.
 */
export function recordOrganizationAudit(
  db: Prisma.TransactionClient,
  entry: {
    actorUserId: string;
    action: OrganizationAuditAction;
    organizationId: string;
    metadata: Prisma.InputJsonObject;
  },
): Promise<unknown> {
  return db.auditLog.create({
    data: {
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: 'Organization',
      entityId: entry.organizationId,
      metadata: entry.metadata,
    },
  });
}
