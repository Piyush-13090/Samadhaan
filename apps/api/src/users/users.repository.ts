import { Injectable } from '@nestjs/common';
import type { Prisma, User, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

/** Fields a user may change about themselves. */
export interface ProfileUpdate {
  fullName?: string;
  displayName?: string;
  avatarUrl?: string;
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
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(update.fullName !== undefined && { fullName: update.fullName }),
        ...(update.displayName !== undefined && { displayName: update.displayName }),
        ...(update.avatarUrl !== undefined && { avatarUrl: update.avatarUrl }),
      },
    });
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
