import { Injectable } from '@nestjs/common';
import type { ProfileActivity } from '@samadhaan/shared';
import type { Prisma, User, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * Fields a user may change about themselves.
 *
 * This type is a second, independent barrier to privilege escalation: even if
 * a DTO were widened by mistake, `role`, `status` and `passwordHash` are not
 * expressible here, so the repository could not write them.
 *
 * `null` clears an optional field; `undefined` leaves it untouched. The two
 * must stay distinguishable, which is why the update builder below checks for
 * `undefined` explicitly rather than using a truthiness test.
 */
export interface ProfileUpdate {
  fullName?: string;
  displayName?: string;
  avatarUrl?: string | null;
  bio?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  phone?: string | null;
}

/**
 * Data access for `User`. Every read excludes soft-deleted rows in one place,
 * so no caller can accidentally resurrect a deleted account.
 */
@Injectable()
export class UsersRepository {
  /** Applied to every query so soft-deleted users stay invisible. */
  private static readonly notDeleted = {
    deletedAt: null,
  } satisfies Prisma.UserWhereInput;

  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { id, ...UsersRepository.notDeleted },
    });
  }

  /** Emails are stored lower-cased; callers may pass any casing. */
  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), ...UsersRepository.notDeleted },
    });
  }

  findByDisplayName(displayName: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { displayName: displayName.toLowerCase(), ...UsersRepository.notDeleted },
    });
  }

  /**
   * Creates an account.
   *
   * `role` is a required explicit argument rather than an optional field on a
   * spread object: every call site has to state the role it is creating, so a
   * privileged account can never be produced by an object that happened to
   * carry a `role` key.
   */
  create(input: {
    email: string;
    passwordHash: string;
    fullName: string;
    role: UserRole;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        role: input.role,
      },
    });
  }

  /**
   * Updates self-editable profile fields.
   *
   * The signature accepts only `ProfileUpdate`, so `role`, `status` and
   * `passwordHash` are not expressible here. Changing a role requires the
   * dedicated administrative path, which is auditable.
   */
  updateProfile(id: string, update: ProfileUpdate): Promise<User> {
    // Built key by key rather than spread, so only fields the caller actually
    // sent are written — and so a `null` (clear this field) is distinguishable
    // from an absent key (leave it alone).
    const data: Prisma.UserUpdateInput = {};

    if (update.fullName !== undefined) data.fullName = update.fullName;
    if (update.displayName !== undefined) data.displayName = update.displayName;
    if (update.avatarUrl !== undefined) data.avatarUrl = update.avatarUrl;
    if (update.bio !== undefined) data.bio = update.bio;
    if (update.city !== undefined) data.city = update.city;
    if (update.state !== undefined) data.state = update.state;
    if (update.country !== undefined) data.country = update.country;
    if (update.postalCode !== undefined) data.postalCode = update.postalCode;
    if (update.phone !== undefined) data.phone = update.phone;

    return this.prisma.user.update({ where: { id }, data });
  }

  /** A user with their organisation memberships loaded, for profile rendering. */
  findByIdWithMemberships(id: string) {
    return this.prisma.user.findFirst({
      where: { id, ...UsersRepository.notDeleted },
      include: {
        organizationMembers: {
          where: { status: { not: 'LEFT' } },
          include: { organization: true },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
  }

  /** Public profile lookup by handle, for `/u/:displayName` in a later milestone. */
  findByDisplayNameWithMemberships(displayName: string) {
    return this.prisma.user.findFirst({
      where: { displayName: displayName.toLowerCase(), ...UsersRepository.notDeleted },
      include: {
        organizationMembers: {
          where: { status: 'ACTIVE' },
          include: { organization: true },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
  }

  /**
   * Civic activity counts for a profile.
   *
   * Every number is counted from the database — nothing is estimated or
   * invented. `impactPoints` is `null` because the ledger does not exist yet,
   * and returning 0 would misrepresent an unbuilt feature as a measured score.
   *
   * The counts run as one batch so a profile page costs a single round trip
   * rather than six.
   */
  async getActivity(userId: string): Promise<ProfileActivity> {
    const [
      problemsReported,
      problemsSupported,
      commentsPosted,
      suggestionsMade,
      problemsResolved,
    ] = await this.prisma.$transaction([
      this.prisma.problem.count({ where: { reporterId: userId, deletedAt: null } }),
      this.prisma.problemVote.count({ where: { userId } }),
      this.prisma.problemComment.count({ where: { userId, deletedAt: null } }),
      this.prisma.problemSuggestion.count({
        where: { authorId: userId, deletedAt: null },
      }),
      // "Contributed to and it was resolved": reported it, supported it, or
      // suggested a fix. Counted on the problem so a user with several kinds of
      // contribution to the same problem is counted once.
      this.prisma.problem.count({
        where: {
          status: 'RESOLVED',
          deletedAt: null,
          OR: [
            { reporterId: userId },
            { votes: { some: { userId } } },
            { suggestions: { some: { authorId: userId } } },
          ],
        },
      }),
    ]);

    return {
      problemsReported,
      problemsSupported,
      commentsPosted,
      suggestionsMade,
      problemsResolved,
      impactPoints: null,
    };
  }

  recordLogin(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  updatePasswordHash(id: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  count(): Promise<number> {
    return this.prisma.user.count({ where: UsersRepository.notDeleted });
  }
}
