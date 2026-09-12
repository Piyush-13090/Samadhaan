import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';

/**
 * User accounts and profiles.
 *
 * Exports the repository so the auth module builds registration and sign-in on
 * it rather than reaching for Prisma directly.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class UsersModule {}
