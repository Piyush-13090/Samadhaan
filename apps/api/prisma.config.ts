import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * Prisma 7 moved the connection URL out of `schema.prisma`: the CLI reads it
 * from here, and the runtime client receives it through a driver adapter (see
 * `src/database/prisma.service.ts`). Both ultimately read `DATABASE_URL`, so
 * there is still one source of truth.
 *
 * The repository-root `.env` is loaded first and an app-local `.env` may
 * override it — the same precedence the NestJS `ConfigModule` uses.
 */
loadEnv({ path: ['.env', '../../.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Development only, and itself guarded — see prisma/seed.ts.
    seed: 'node dist/database/seed.js',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
