import type { Prisma } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/database/prisma.service.js';

/**
 * Deletes audit rows a test created.
 *
 * `audit_logs` is append-only at the database (see the Prompt 15 migration):
 * deletes are refused unless the transaction opts into maintenance. Tests
 * clean up after themselves, so they — and only they — use this.
 */
export async function deleteAuditLogs(
  prisma: PrismaService,
  where: Prisma.AuditLogWhereInput,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('samadhaan.audit_maintenance', 'on', true)`;
    await tx.auditLog.deleteMany({ where });
  });
}
