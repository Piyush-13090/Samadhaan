/**
 * Development seed — creates one account per role for local testing.
 *
 * ⚠️  DEVELOPMENT ONLY. These accounts share a well-known password that is
 * published in the README. They must never exist anywhere reachable from the
 * internet.
 *
 * Two independent guards, so no single misconfigured variable is enough:
 *   1. `NODE_ENV` must not be `production`.
 *   2. `ALLOW_DEV_SEED` must be exactly `true`.
 *
 * Lives under `src/` rather than `prisma/` so it compiles with the application
 * and runs against the same generated client the API uses — a seed built from a
 * second, differently-resolved copy of the client is a class of drift bug worth
 * avoiding. Run with `npm run db:seed`, which builds first.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '../generated/prisma/client.js';

loadEnv({ path: ['.env', '../../.env'], quiet: true });

const DEV_PASSWORD = 'DevPassword123!';

/** Matches `PasswordService` so seeded hashes never trigger a rehash. */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const ACCOUNTS = [
  {
    email: 'citizen@samadhaan.dev',
    fullName: 'Priya Sharma',
    displayName: 'priya',
    role: 'CITIZEN',
  },
  {
    email: 'ngo@samadhaan.dev',
    fullName: 'Vikram Rao',
    displayName: 'vikram',
    role: 'NGO',
  },
  {
    email: 'university@samadhaan.dev',
    fullName: 'Dr Anita Menon',
    displayName: 'anita',
    role: 'UNIVERSITY',
  },
  {
    email: 'industry@samadhaan.dev',
    fullName: 'Rohan Kapoor',
    displayName: 'rohan',
    role: 'INDUSTRY',
  },
  {
    email: 'government@samadhaan.dev',
    fullName: 'S. Krishnan',
    displayName: 'krishnan',
    role: 'GOVERNMENT',
  },
  {
    email: 'admin@samadhaan.dev',
    fullName: 'Platform Admin',
    displayName: 'admin',
    role: 'ADMIN',
  },
] as const;

function assertSafeToSeed(): void {
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  if (nodeEnv === 'production') {
    throw new Error('Refusing to seed: NODE_ENV is production.');
  }

  if (process.env.ALLOW_DEV_SEED !== 'true') {
    throw new Error(
      'Refusing to seed: set ALLOW_DEV_SEED=true in .env to create development accounts.',
    );
  }
}

async function main(): Promise<void> {
  assertSafeToSeed();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const passwordHash = await argon2.hash(DEV_PASSWORD, ARGON2_OPTIONS);

    for (const account of ACCOUNTS) {
      // Idempotent: re-running resets the password and role but keeps the id,
      // so anything referencing a seeded user survives a reseed.
      await prisma.user.upsert({
        where: { email: account.email },
        update: {
          passwordHash,
          fullName: account.fullName,
          role: account.role,
          status: 'ACTIVE',
        },
        create: {
          email: account.email,
          passwordHash,
          fullName: account.fullName,
          displayName: account.displayName,
          role: account.role,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      });

      console.log(`  ✓ ${account.role.padEnd(11)} ${account.email}`);
    }

    console.log(`\nSeeded ${ACCOUNTS.length} development accounts.`);
    console.log(
      'Password for all of them is documented in the README (development only).',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
