import { describe, expect, it, vi } from 'vitest';
import type { RequestUser } from '../auth/auth.types.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { OrganizationMember } from '../generated/prisma/client.js';
import { OrganizationAccessService } from './organization-access.service.js';
import { escapeLike } from './workspace/organization-problems.service.js';

const ORG = 'org-1';

function member(
  userId: string,
  membershipRole: OrganizationMember['membershipRole'],
): OrganizationMember {
  return {
    id: `m-${userId}`,
    organizationId: ORG,
    userId,
    membershipRole,
    status: 'ACTIVE',
    joinedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function user(id: string, role: RequestUser['role'] = 'NGO'): RequestUser {
  return { id, email: `${id}@example.test`, role, status: 'ACTIVE', sessionId: 's' };
}

/** An access service over a fake team; `owners` is how many OWNER rows exist. */
function serviceWith(team: OrganizationMember[], owners = 1) {
  const prisma = {
    organizationMember: {
      findFirst: vi.fn(
        async ({ where }: { where: { userId: string } }) =>
          team.find((row) => row.userId === where.userId) ?? null,
      ),
    },
    $queryRaw: vi.fn(async () =>
      Array.from({ length: owners }, (_, i) => ({ id: `o${i}` })),
    ),
  } as unknown as PrismaService;
  return new OrganizationAccessService(prisma);
}

describe('OrganizationAccessService', () => {
  describe('assertCanChangeMember', () => {
    const owner = member('owner', 'OWNER');
    const admin = member('admin', 'ADMIN');
    const plain = member('plain', 'MEMBER');
    const team = [owner, admin, plain];

    it('refuses anyone changing their own membership', async () => {
      const access = serviceWith(team, 2);
      for (const self of team) {
        await expect(
          access.assertCanChangeMember(ORG, user(self.userId), self, 'OWNER'),
        ).rejects.toThrow(/your own membership/);
      }
    });

    it('refuses a MEMBER changing anyone', async () => {
      await expect(
        serviceWith(team).assertCanChangeMember(ORG, user('plain'), admin, 'MEMBER'),
      ).rejects.toThrow(/do not have access/);
    });

    it('refuses an ADMIN touching an owner or granting ownership', async () => {
      const access = serviceWith(team, 2);
      await expect(
        access.assertCanChangeMember(ORG, user('admin'), owner, 'MEMBER'),
      ).rejects.toThrow(/Only an owner can change another owner/);
      await expect(
        access.assertCanChangeMember(ORG, user('admin'), owner, null),
      ).rejects.toThrow(/Only an owner can change another owner/);
      await expect(
        access.assertCanChangeMember(ORG, user('admin'), plain, 'OWNER'),
      ).rejects.toThrow(/Only an owner can make someone an owner/);
    });

    it('lets an ADMIN move a member between MEMBER and ADMIN', async () => {
      await expect(
        serviceWith(team).assertCanChangeMember(ORG, user('admin'), plain, 'ADMIN'),
      ).resolves.toBeUndefined();
    });

    it('lets an OWNER grant ownership', async () => {
      await expect(
        serviceWith(team).assertCanChangeMember(ORG, user('owner'), plain, 'OWNER'),
      ).resolves.toBeUndefined();
    });

    it('never demotes or removes the last owner, even for a platform admin', async () => {
      const access = serviceWith(team, 1);
      const platformAdmin = user('root', 'ADMIN');
      await expect(
        access.assertCanChangeMember(ORG, platformAdmin, owner, 'ADMIN'),
      ).rejects.toThrow(/only owner/);
      await expect(
        access.assertCanChangeMember(ORG, platformAdmin, owner, null),
      ).rejects.toThrow(/only owner/);
    });

    it('treats a non-member platform admin as an owner otherwise', async () => {
      await expect(
        serviceWith(team, 2).assertCanChangeMember(
          ORG,
          user('root', 'ADMIN'),
          owner,
          'ADMIN',
        ),
      ).resolves.toBeUndefined();
    });

    it('refuses a stranger', async () => {
      await expect(
        serviceWith(team).assertCanChangeMember(ORG, user('stranger'), plain, 'ADMIN'),
      ).rejects.toThrow(/do not have access/);
    });
  });

  describe('workspacePermissions', () => {
    it('lets an owner assign every role, an admin all but owner, a member none', () => {
      expect(
        OrganizationAccessService.workspacePermissions(member('a', 'OWNER'))
          .assignableRoles,
      ).toEqual(['OWNER', 'ADMIN', 'MEMBER']);
      expect(
        OrganizationAccessService.workspacePermissions(member('a', 'ADMIN'))
          .assignableRoles,
      ).toEqual(['ADMIN', 'MEMBER']);
      expect(
        OrganizationAccessService.workspacePermissions(member('a', 'MEMBER')),
      ).toEqual({
        canEditProfile: false,
        canManageExpertise: false,
        canManageMembers: false,
        assignableRoles: [],
      });
    });
  });

  describe('isOperational', () => {
    const base = {
      isActive: true,
      verificationStatus: 'VERIFIED' as const,
      deletedAt: null,
    };

    it('is open for any verification state but suspension', () => {
      for (const status of ['PENDING', 'VERIFIED', 'REJECTED'] as const) {
        expect(
          OrganizationAccessService.isOperational({
            ...base,
            verificationStatus: status,
          }),
        ).toBe(true);
      }
    });

    it('closes when suspended, deactivated or deleted', () => {
      expect(
        OrganizationAccessService.isOperational({
          ...base,
          verificationStatus: 'SUSPENDED',
        }),
      ).toBe(false);
      expect(OrganizationAccessService.isOperational({ ...base, isActive: false })).toBe(
        false,
      );
      expect(
        OrganizationAccessService.isOperational({ ...base, deletedAt: new Date() }),
      ).toBe(false);
    });
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('100%_done\\')).toBe('100\\%\\_done\\\\');
    expect(escapeLike('plain text')).toBe('plain text');
  });
});
