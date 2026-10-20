import type { AddressInfo, Server } from 'node:net';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnv } from 'dotenv';
import supertest from 'supertest';
import { afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * Point supertest at the loopback address its server actually owns.
 *
 * supertest starts the app with `server.listen(0)` (no host), then connects
 * to `127.0.0.1:<port>`. Without a host, Node binds the IPv6 wildcard `::`,
 * and the kernel only guarantees the port is free for that socket. On macOS a
 * different process can still own the same port on 127.0.0.1 (VS Code helpers
 * listen in the ephemeral range), and a connection to 127.0.0.1 then reaches
 * that process instead of the app under test. That caused the intermittent
 * "impossible" 401s and 404s in local e2e runs (diagnosed 2026-10-20).
 *
 * When the server is bound to `::`, connect to `[::1]` instead: that address
 * is covered by the server's own socket. Where IPv6 is unavailable, Node binds
 * IPv4 and the URL is left unchanged. The bind stays synchronous, which
 * supertest relies on.
 */
type ServerAddress = (this: unknown, app: Server, path: string) => string;
const proto = supertest.Test.prototype as unknown as { serverAddress: ServerAddress };
const serverAddress = proto.serverAddress;
proto.serverAddress = function (app, path) {
  const url = serverAddress.call(this, app, path);
  const address = app.address() as AddressInfo | null;
  return address?.family === 'IPv6' && address.address === '::'
    ? url.replace('://127.0.0.1:', '://[::1]:')
    : url;
};

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
