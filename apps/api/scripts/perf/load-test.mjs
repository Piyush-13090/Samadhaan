#!/usr/bin/env node
/**
 * Samadhaan load test (Prompt 27). Dependency-free: Node's fetch (undici)
 * with keep-alive, fixed concurrency, fixed duration per scenario.
 *
 * Run ONLY against a dedicated benchmark API backed by a *_perf database —
 * never production or the shared development database.
 *
 *   PERF_API=http://localhost:4100 node scripts/perf/load-test.mjs \
 *     [--scenarios=a,b] [--concurrency=10] [--duration=20] [--out=file.json]
 *
 * Virtual users sign in as distinct synthetic accounts (perf-user-N) and, as
 * distinct clients do, from distinct addresses (X-Forwarded-For, which the API
 * trusts for one proxy hop), so per-user and per-IP rate limits behave as they
 * would for that many real people rather than throttling one test client.
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const BASE = process.env.PERF_API ?? 'http://localhost:4100';
const CONCURRENCY = Number(args.concurrency ?? 10);
const DURATION_S = Number(args.duration ?? 20);
/** Distinct citizen accounts to rotate through, so per-user rate limits apply as for real users. */
const USERS = Number(args.users ?? 300);
const PASSWORD = process.env.PERF_PASSWORD ?? 'DevPassword123!';
const ORIGIN = process.env.PERF_ORIGIN ?? 'http://localhost:3100';

/** Accounts: users 1..40 are officials (two per office), 841.. are citizens. */
const citizenEmail = (i) => `perf-user-${1000 + i}@perf.test`;
const officialEmail = (i) => `perf-user-${1 + (i % 2) * 20}@perf.test`; // office 0

const SCENARIOS = {
  'citizen-dashboard': { role: 'citizen', path: () => '/dashboard/citizen' },
  'problem-listing': { role: 'citizen', path: () => '/problems/nearby?limit=20' },
  'nearby-search': {
    role: 'citizen',
    path: (n) =>
      `/problems/nearby?latitude=${(18.45 + (n % 10) * 0.015).toFixed(3)}&longitude=73.86&radiusMeters=5000&limit=20`,
  },
  'search-suggest': {
    role: 'citizen',
    path: (n) => `/search/suggest?q=${['dra', 'poth', 'garb', 'stree', 'wat'][n % 5]}`,
  },
  'search-problems-keyword': {
    role: 'citizen',
    path: (n) =>
      `/search/problems?q=${encodeURIComponent(['blocked drain', 'pothole road', 'garbage pile', 'streetlight dark', 'pipeline leak'][n % 5])}&interpret=false&limit=20`,
  },
  'search-unified': {
    role: 'citizen',
    path: (n) =>
      `/search?q=${encodeURIComponent(['drainage problems in Pune', 'potholes', 'garbage near market'][n % 3])}`,
  },
  'gov-review-queue': {
    role: 'official',
    path: () => '/government/perf-office-0/problems?view=queue&page=1&limit=20',
  },
  'gov-dashboard': {
    role: 'official',
    path: () => '/government/perf-office-0/dashboard?range=30',
  },
  'analytics-overview': {
    role: 'official',
    path: () => '/government/perf-office-0/analytics/overview?preset=90d',
  },
  'analytics-resolution': {
    role: 'official',
    path: () => '/government/perf-office-0/analytics/resolution?preset=90d',
  },
  'knowledge-search': {
    role: 'citizen',
    path: (n) =>
      `/search/knowledge?q=${encodeURIComponent(['clear storm drains', 'repair potholes', 'streetlight maintenance'][n % 3])}`,
  },
  notifications: { role: 'citizen', path: () => '/notifications?limit=20' },
  leaderboard: { role: 'citizen', path: () => '/leaderboard?period=month' },
};

async function login(email, ip) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      'x-forwarded-for': ip,
    },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${email} → ${res.status}`);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

const pct = (sorted, p) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
    : null;
const r1 = (n) => (n === null ? null : Math.round(n * 10) / 10);

async function runScenario(name, def, sessions) {
  const latencies = [];
  const statuses = {};
  let errors = 0;
  let n = 0;
  const deadline = performance.now() + DURATION_S * 1000;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async (_, vu) => {
      const pool = sessions[def.role];
      while (performance.now() < deadline) {
        const i = n++;
        const session = pool[(vu + i * CONCURRENCY) % pool.length];
        const t0 = performance.now();
        try {
          const res = await fetch(`${BASE}/api/v1${def.path(i)}`, {
            headers: {
              cookie: session.cookie,
              'x-forwarded-for': session.ip,
              'x-request-id': `perf-${name}-${i}`,
            },
          });
          await res.arrayBuffer();
          statuses[res.status] = (statuses[res.status] ?? 0) + 1;
          if (res.status >= 400) errors++;
        } catch {
          errors++;
          statuses.network = (statuses.network ?? 0) + 1;
        }
        latencies.push(performance.now() - t0);
      }
    }),
  );
  const elapsed = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  return {
    scenario: name,
    concurrency: CONCURRENCY,
    durationS: r1(elapsed),
    requests: latencies.length,
    rps: r1(latencies.length / elapsed),
    p50: r1(pct(latencies, 50)),
    p95: r1(pct(latencies, 95)),
    p99: r1(pct(latencies, 99)),
    max: r1(latencies.at(-1) ?? null),
    errorRate: latencies.length ? Math.round((errors / latencies.length) * 1000) / 10 : 0,
    statuses,
  };
}

const names = (args.scenarios ?? Object.keys(SCENARIOS).join(',')).split(',');
const sessions = { citizen: [], official: [] };
for (let batch = 0; batch < USERS; batch += 25) {
  await Promise.all(
    Array.from({ length: Math.min(25, USERS - batch) }, async (_, k) => {
      const i = batch + k;
      const ip = `10.27.${Math.floor(i / 250)}.${(i % 250) + 1}`;
      sessions.citizen.push({ cookie: await login(citizenEmail(i), ip), ip });
    }),
  );
}
for (let i = 0; i < Math.min(CONCURRENCY, 2); i++) {
  const ip = `10.28.0.${i + 1}`;
  sessions.official.push({ cookie: await login(officialEmail(i), ip), ip });
}

// Between scenarios, reset rate-limit windows in the *dedicated* benchmark
// Redis, so one scenario's quota use does not throttle the next (scenarios
// share per-user buckets). Never point PERF_REDIS_URL at a shared Redis.
let redis = null;
if (process.env.PERF_REDIS_URL) {
  const { default: Redis } = await import('ioredis');
  redis = new Redis(process.env.PERF_REDIS_URL);
}
async function resetRateLimits() {
  if (!redis) return;
  const keys = await redis.keys('ratelimit:*');
  if (keys.length) await redis.del(...keys);
}

const results = [];
for (const name of names) {
  await resetRateLimits();
  const def = SCENARIOS[name];
  if (!def) throw new Error(`unknown scenario ${name}`);
  // Warm-up: one request, so connection setup and first-hit caches are not timed.
  await fetch(`${BASE}/api/v1${def.path(0)}`, {
    headers: {
      cookie: sessions[def.role][0].cookie,
      'x-forwarded-for': sessions[def.role][0].ip,
    },
  }).then((r) => r.arrayBuffer());
  const result = await runScenario(name, def, sessions);
  results.push(result);
  console.log(
    `${name.padEnd(26)} c=${result.concurrency} req=${String(result.requests).padStart(5)} rps=${String(result.rps).padStart(6)} ` +
      `p50=${result.p50}ms p95=${result.p95}ms p99=${result.p99}ms err=${result.errorRate}% ${JSON.stringify(result.statuses)}`,
  );
}
await redis?.quit();
if (args.out)
  writeFileSync(
    args.out,
    JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2),
  );
