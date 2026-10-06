import { PROJECT_NAME_MAX_LENGTH, projectToday } from '@samadhaan/shared';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * Opens the resolution room for an allocation that has just been accepted.
 *
 * Called **inside** the acceptance transaction (AllocationsService.accept),
 * after the allocation row is ACCEPTED and the problem IN_PROGRESS. Any
 * failure here — the unique allocation constraint, the trigger that checks
 * the allocation, a lost connection — throws, and the whole acceptance rolls
 * back: there is never an accepted allocation without its room.
 */
export async function openRoomInTransaction(
  tx: Prisma.TransactionClient,
  allocation: {
    id: string;
    problemId: string;
    organizationId: string;
    governmentOrganizationId: string;
  },
  actorUserId: string,
  organizationName: string,
): Promise<{ id: string }> {
  const room = await tx.resolutionRoom.create({
    data: {
      problemId: allocation.problemId,
      allocationId: allocation.id,
      governmentOrganizationId: allocation.governmentOrganizationId,
      assignedOrganizationId: allocation.organizationId,
    },
    select: { id: true },
  });

  await tx.resolutionRoomEvent.create({
    data: {
      roomId: room.id,
      type: 'ROOM_CREATED',
      actorId: actorUserId,
      metadata: { allocationId: allocation.id, organizationName },
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId,
      action: 'RESOLUTION_ROOM_CREATED',
      entityType: 'ResolutionRoom',
      entityId: room.id,
      metadata: {
        allocationId: allocation.id,
        problemId: allocation.problemId,
        organizationId: allocation.governmentOrganizationId,
        assignedOrganizationId: allocation.organizationId,
      },
    },
  });

  await createProjectInTransaction(
    tx,
    room.id,
    allocation,
    actorUserId,
    organizationName,
  );

  return room;
}

/**
 * The room's resolution project (Prompt 18), in the same transaction. Name and
 * description come from the problem, deterministically — no generated text,
 * no invented details. Either side's managers can edit them later.
 */
async function createProjectInTransaction(
  tx: Prisma.TransactionClient,
  roomId: string,
  allocation: {
    id: string;
    problemId: string;
    organizationId: string;
    governmentOrganizationId: string;
  },
  actorUserId: string,
  organizationName: string,
): Promise<void> {
  const problem = await tx.problem.findUniqueOrThrow({
    where: { id: allocation.problemId },
    select: { title: true, address: true, city: true },
  });
  const { name, description } = initialProjectText(problem);

  const project = await tx.resolutionProject.create({
    data: {
      roomId,
      problemId: allocation.problemId,
      allocationId: allocation.id,
      governmentOrganizationId: allocation.governmentOrganizationId,
      assignedOrganizationId: allocation.organizationId,
      name,
      description,
      startDate: new Date(`${projectToday()}T00:00:00Z`),
      createdById: actorUserId,
    },
    select: { id: true },
  });

  await tx.resolutionRoomEvent.create({
    data: {
      roomId,
      type: 'PROJECT_CREATED',
      actorId: actorUserId,
      metadata: { projectId: project.id, subject: name, organizationName },
    },
  });
}

export function initialProjectText(problem: {
  title: string;
  address: string | null;
  city: string | null;
}): { name: string; description: string } {
  const place = [problem.address, problem.city].filter(Boolean).join(', ');
  return {
    name: `Resolve: ${problem.title}`.slice(0, PROJECT_NAME_MAX_LENGTH),
    description: `Resolution project for "${problem.title}"${place ? `, reported at ${place}` : ''}.`,
  };
}
