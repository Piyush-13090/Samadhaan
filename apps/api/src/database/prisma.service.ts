import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { err, ok, toErrorMessage, type Result } from '@samadhaan/shared';
import { AppConfig } from '../config/app.config.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Owns the single `PrismaClient` instance for the process.
 *
 * Prisma 7 connects through a driver adapter rather than a URL in the schema,
 * so the connection string comes from validated config like every other
 * setting — there is no second place where `DATABASE_URL` is read at runtime.
 *
 * Connection is attempted at startup, but a failure is logged rather than
 * thrown: the API stays up so `/health` can report `database: down` instead of
 * the process crash-looping and telling operators nothing.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfig) {
    super({
      adapter: new PrismaPg({ connectionString: config.databaseUrl }),
      log: config.isDevelopment ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Connected to PostgreSQL');
    } catch (error) {
      this.logger.error(`Initial database connection failed: ${toErrorMessage(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Cheap liveness probe used by the health module. Never throws. */
  async ping(): Promise<Result<true>> {
    try {
      await this.$queryRaw`SELECT 1`;
      return ok(true);
    } catch (error) {
      return err(new Error(toErrorMessage(error)));
    }
  }
}
