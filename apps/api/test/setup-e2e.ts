import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnv } from 'dotenv';
import { afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * Keeps e2e runs from leaving notifications behind in the development database.
 *
 * Suites create problems, comment, support and confirm duplicates against the
 * real database, and since Prompt 11 each of those also writes notifications to
 * the seeded accounts. The suites delete their problems afterwards, but a
 * notification has no foreign key to its problem (by design — see
 * docs/DATABASE.md §14g), so without this they would pile up as dead links on
 * the developer's own bell.
 *
 * Registered as a setup file, so it wraps every e2e file: anything created
 * while that file ran is removed when it finishes. Seed rows are never touched.
 * Files run one at a time (`fileParallelism: false`), so the window is the file.
 */
loadEnv({ path: ['.env', '../../.env'], quiet: true });

// Organisation matching (Prompt 14) runs in the background after every
// analysis. Off for e2e files by default, so no suite's fixtures race a
// detached job; the matching suite turns it back on for itself.
process.env.MATCHING_ENABLED = 'false';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

let startedAt: Date;

beforeAll(() => {
  // This process's clock, compared through Prisma — the same path that wrote
  // `createdAt`. Not the database's `now()`: with a non-UTC session time zone
  // the pg adapter stores client-supplied timestamps shifted by the zone
  // offset, so a raw `now()` would not be comparable (see the note in
  // docs/DATABASE.md §16). A second's margin absorbs clock granularity.
  startedAt = new Date(Date.now() - 1000);
});

afterAll(async () => {
  try {
    await prisma.notification.deleteMany({
      where: {
        createdAt: { gte: startedAt },
        dedupeKey: { not: { startsWith: 'seed:' } },
      },
    });
  } finally {
    await prisma.$disconnect();
  }
});
