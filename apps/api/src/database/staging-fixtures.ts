/**
 * Staging smoke-test fixtures (release blocker B4, 2026-10-19).
 *
 * Creates the synthetic accounts and organisations that
 * `scripts/smoke/staging-smoke.mjs` needs, on a staging database only:
 *
 *   - a citizen;
 *   - a government office ("smoke city") and its official (OWNER);
 *   - a second office and official, for the jurisdiction-isolation step;
 *   - a VERIFIED NGO and its owner.
 *
 * None of these can be made through the application: organisation
 * verification has no endpoint, and offices are configured by operators.
 * So the script writes them directly, under strict rules:
 *
 *   - It runs only when SAMADHAAN_DEPLOY_ENV=staging, connects only to
 *     STAGING_DATABASE_URL (never DATABASE_URL), and refuses unless the
 *     connected database's name equals --confirm-database AND carries the
 *     staging COMMENT marker (see staging-fixtures.guard.ts).
 *   - It only creates or updates rows it owns: emails
 *     `staging-smoke-*@samadhaan.test`, slugs `staging-smoke-*`, and the
 *     fixture name and description markers. It refuses if a reserved email or
 *     slug is held by anything else, so a real organisation is never verified.
 *   - It never deletes or truncates. Repeated runs converge on the same state.
 *   - Passwords are random, written only to the --credentials-out file (mode
 *     0600, outside any Git working tree), never printed.
 *
 * Modes:
 *   (default)           create or reconcile the fixtures
 *   --rotate-passwords  issue new passwords and revoke the fixtures' sessions
 *   --retire            suspend the fixture accounts, revoke their sessions
 *                       and deactivate the fixture organisations (no deletes)
 *
 * Run from apps/api (or in the api-migrate image):
 *   SAMADHAAN_DEPLOY_ENV=staging STAGING_DATABASE_URL=postgresql://… \
 *     node dist/database/staging-fixtures.js \
 *       --confirm-database=<name> --credentials-out=/secure/path/smoke.env
 *
 * Documented in docs/STAGING_SMOKE_TESTS.md.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PrismaClient } from '../generated/prisma/client.js';
import type { OrganizationType, UserRole } from '../generated/prisma/client.js';
import {
  FIXTURE_DESCRIPTION,
  FIXTURE_EMAIL_DOMAIN,
  FIXTURE_EMAIL_PREFIX,
  FIXTURE_NAME_PREFIX,
  FIXTURE_SLUG_PREFIX,
  credentialsPathProblems,
  databaseProblems,
  preflightProblems,
  type StagingTargetInput,
} from './staging-fixtures.guard.js';

/** Matches `PasswordService`, so fixture hashes never trigger a rehash. */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

// A fictional city keeps the smoke offices' queues to smoke reports only:
// jurisdiction matches by city when an office has no boundary. No spaces:
// the credentials file must be valid for both `source` and `--env-file`.
const SMOKE_CITY = 'SmokeTestCity';
const OTHER_CITY = 'SmokeTestOtherCity';
const SMOKE_LATITUDE = '28.4595';
const SMOKE_LONGITUDE = '77.0266';

interface AccountSpec {
  key: 'citizen' | 'official' | 'otherOfficial' | 'orgOwner';
  email: string;
  role: UserRole;
  fullName: string;
}

const account = (
  key: AccountSpec['key'],
  local: string,
  role: UserRole,
  name: string,
): AccountSpec => ({
  key,
  role,
  email: `${FIXTURE_EMAIL_PREFIX}${local}${FIXTURE_EMAIL_DOMAIN}`,
  fullName: `${FIXTURE_NAME_PREFIX} ${name}`,
});

const ACCOUNTS: AccountSpec[] = [
  account('citizen', 'citizen', 'CITIZEN', 'Citizen'),
  account('official', 'official', 'GOVERNMENT', 'Official'),
  account('otherOfficial', 'other-official', 'GOVERNMENT', 'Other Official'),
  account('orgOwner', 'ngo-owner', 'NGO', 'NGO Owner'),
];

interface OrgSpec {
  key: 'office' | 'otherOffice' | 'ngo';
  slug: string;
  name: string;
  type: OrganizationType;
  city: string;
  owner: AccountSpec['key'];
}

const org = (
  key: OrgSpec['key'],
  local: string,
  name: string,
  type: OrganizationType,
  city: string,
  owner: AccountSpec['key'],
): OrgSpec => ({
  key,
  type,
  city,
  owner,
  slug: `${FIXTURE_SLUG_PREFIX}${local}`,
  name: `${FIXTURE_NAME_PREFIX} ${name}`,
});

const ORGS: OrgSpec[] = [
  org('office', 'office', 'Office', 'GOVERNMENT', SMOKE_CITY, 'official'),
  org(
    'otherOffice',
    'other-office',
    'Other Office',
    'GOVERNMENT',
    OTHER_CITY,
    'otherOfficial',
  ),
  org('ngo', 'ngo', 'NGO', 'NGO', SMOKE_CITY, 'orgOwner'),
];

type Mode = 'reconcile' | 'rotate' | 'retire';

function parseArgs(argv: string[]) {
  const flag = (name: string) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const mode: Mode = argv.includes('--retire')
    ? 'retire'
    : argv.includes('--rotate-passwords')
      ? 'rotate'
      : 'reconcile';
  return {
    mode,
    confirmDatabase: flag('confirm-database'),
    credentialsOut: flag('credentials-out'),
  };
}

function insideGitWorkTree(path: string): boolean {
  let dir = dirname(path);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function refuse(problems: string[]): never {
  console.error('Refusing to run staging-fixtures:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(2);
}

/** Reads `KEY=value` lines from an existing credentials file. */
function readCredentials(path: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1]!, match[2]!);
  }
  return values;
}

const PASSWORD_KEYS: Record<AccountSpec['key'], string> = {
  citizen: 'SMOKE_CITIZEN_PASSWORD',
  official: 'SMOKE_OFFICIAL_PASSWORD',
  otherOfficial: 'SMOKE_OTHER_OFFICIAL_PASSWORD',
  orgOwner: 'SMOKE_ORG_PASSWORD',
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target: StagingTargetInput = {
    deployEnv: process.env.SAMADHAAN_DEPLOY_ENV,
    databaseUrl: process.env.STAGING_DATABASE_URL,
    confirmDatabase: args.confirmDatabase,
  };

  const early = [
    ...preflightProblems(target),
    ...(args.mode === 'retire'
      ? []
      : credentialsPathProblems(args.credentialsOut, insideGitWorkTree)),
  ];
  if (early.length) refuse(early);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: target.databaseUrl! }),
  });
  try {
    const [facts] = await prisma.$queryRaw<
      Array<{ name: string; comment: string | null }>
    >`
      SELECT current_database() AS name,
             shobj_description(d.oid, 'pg_database') AS comment
      FROM pg_database d WHERE d.datname = current_database()
    `;
    const late = databaseProblems(target, facts ?? { name: '?', comment: null });
    if (late.length) refuse(late);

    // Ownership: a reserved email or slug held by anything not created here
    // stops the run before anything is written.
    const users = await prisma.user.findMany({
      where: { email: { in: ACCOUNTS.map((a) => a.email) } },
    });
    const orgs = await prisma.organization.findMany({
      where: { slug: { in: ORGS.map((o) => o.slug) } },
    });
    const foreign = [
      ...users
        .filter((u) => !u.fullName.startsWith(FIXTURE_NAME_PREFIX))
        .map((u) => `User ${u.email} exists but was not created by this script.`),
      ...orgs
        .filter((o) => o.description !== FIXTURE_DESCRIPTION)
        .map((o) => `Organisation ${o.slug} exists but was not created by this script.`),
    ];
    if (foreign.length) refuse(foreign);

    if (args.mode === 'retire') {
      await retire(
        prisma,
        users.map((u) => u.id),
        orgs.map((o) => o.id),
      );
      return;
    }

    const credentialsPath = args.credentialsOut!;
    const known = readCredentials(credentialsPath);
    const existing = new Map(users.map((u) => [u.email, u]));
    const passwords = new Map<AccountSpec['key'], string>();
    const missing: string[] = [];

    for (const spec of ACCOUNTS) {
      const user = existing.get(spec.email);
      const stored = known.get(PASSWORD_KEYS[spec.key]);
      if (!user || args.mode === 'rotate') {
        passwords.set(spec.key, randomBytes(24).toString('base64url'));
      } else if (
        stored &&
        user.passwordHash &&
        (await argon2.verify(user.passwordHash, stored))
      ) {
        passwords.set(spec.key, stored);
      } else {
        missing.push(spec.email);
      }
    }
    if (missing.length) {
      refuse([
        `No valid password on file for ${missing.join(', ')}. ` +
          'Use the original --credentials-out file, or pass --rotate-passwords to issue new ones.',
      ]);
    }

    const ids = new Map<AccountSpec['key'], string>();
    for (const spec of ACCOUNTS) {
      const password = passwords.get(spec.key)!;
      const user = existing.get(spec.email);
      const passwordHash =
        user && args.mode !== 'rotate'
          ? user.passwordHash
          : await argon2.hash(password, ARGON2_OPTIONS);
      const row = await prisma.user.upsert({
        where: { email: spec.email },
        update: {
          role: spec.role,
          status: 'ACTIVE',
          fullName: spec.fullName,
          passwordHash,
          deletedAt: null,
        },
        create: {
          email: spec.email,
          role: spec.role,
          status: 'ACTIVE',
          fullName: spec.fullName,
          passwordHash,
          city: spec.key === 'otherOfficial' ? OTHER_CITY : SMOKE_CITY,
        },
      });
      if (user && args.mode === 'rotate') {
        await prisma.session.updateMany({
          where: { userId: row.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      ids.set(spec.key, row.id);
    }

    const orgIds = new Map<OrgSpec['key'], string>();
    for (const spec of ORGS) {
      const government = spec.type === 'GOVERNMENT';
      const fields = {
        name: spec.name,
        type: spec.type,
        description: FIXTURE_DESCRIPTION,
        city: spec.city,
        country: 'India',
        isActive: true,
        verificationStatus: 'VERIFIED' as const,
        ...(government
          ? {
              jurisdictionType: 'MUNICIPAL_CORPORATION' as const,
              jurisdictionName: `${spec.city} (synthetic)`,
              jurisdictionCities: [spec.city],
            }
          : {}),
      };
      const row = await prisma.organization.upsert({
        where: { slug: spec.slug },
        update: fields,
        create: { slug: spec.slug, verifiedAt: new Date(), ...fields },
      });
      orgIds.set(spec.key, row.id);
      await prisma.organizationMember.upsert({
        where: {
          organizationId_userId: { organizationId: row.id, userId: ids.get(spec.owner)! },
        },
        update: { membershipRole: 'OWNER', status: 'ACTIVE' },
        create: {
          organizationId: row.id,
          userId: ids.get(spec.owner)!,
          membershipRole: 'OWNER',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
    }

    const email = (key: AccountSpec['key']) => ACCOUNTS.find((a) => a.key === key)!.email;
    const slug = (key: OrgSpec['key']) => ORGS.find((o) => o.key === key)!.slug;
    const lines = [
      '# Staging smoke-test credentials. Generated by staging-fixtures.',
      '# Secret: keep in the staging secret store; never commit or paste.',
      '# Add SMOKE_WEB_URL yourself.',
      `SMOKE_CITIZEN_EMAIL=${email('citizen')}`,
      `SMOKE_CITIZEN_PASSWORD=${passwords.get('citizen')}`,
      `SMOKE_OFFICIAL_EMAIL=${email('official')}`,
      `SMOKE_OFFICIAL_PASSWORD=${passwords.get('official')}`,
      `SMOKE_OFFICE_SLUG=${slug('office')}`,
      `SMOKE_LATITUDE=${SMOKE_LATITUDE}`,
      `SMOKE_LONGITUDE=${SMOKE_LONGITUDE}`,
      `SMOKE_CITY=${SMOKE_CITY}`,
      `SMOKE_ORG_EMAIL=${email('orgOwner')}`,
      `SMOKE_ORG_PASSWORD=${passwords.get('orgOwner')}`,
      `SMOKE_ORG_SLUG=${slug('ngo')}`,
      `SMOKE_ORG_ID=${orgIds.get('ngo')}`,
      `SMOKE_OTHER_OFFICIAL_EMAIL=${email('otherOfficial')}`,
      `SMOKE_OTHER_OFFICIAL_PASSWORD=${passwords.get('otherOfficial')}`,
      `SMOKE_OTHER_OFFICE_SLUG=${slug('otherOffice')}`,
      '',
    ];
    writeFileSync(credentialsPath, lines.join('\n'), { mode: 0o600 });

    // Names only: no password, hash, token or connection string is printed.
    console.log(`staging-fixtures: ${args.mode} complete on database "${facts!.name}".`);
    for (const a of ACCOUNTS) console.log(`  account       ${a.email} (${a.role})`);
    for (const o of ORGS) console.log(`  organisation  ${o.slug} (${o.type}, VERIFIED)`);
    console.log(`  credentials   written to the --credentials-out file (mode 0600)`);
  } finally {
    await prisma.$disconnect();
  }
}

/** Suspends fixture accounts and deactivates fixture organisations. No deletes. */
async function retire(prisma: PrismaClient, userIds: string[], orgIds: string[]) {
  const now = new Date();
  const sessions = await prisma.session.updateMany({
    where: { userId: { in: userIds }, revokedAt: null },
    data: { revokedAt: now },
  });
  const accounts = await prisma.user.updateMany({
    where: { id: { in: userIds } },
    data: { status: 'SUSPENDED' },
  });
  const organisations = await prisma.organization.updateMany({
    where: { id: { in: orgIds } },
    data: { isActive: false },
  });
  console.log(
    `staging-fixtures: retired ${accounts.count} accounts, ${organisations.count} organisations; revoked ${sessions.count} sessions. Nothing was deleted.`,
  );
}

main().catch((error: unknown) => {
  // The message only: Prisma errors can echo the connection target.
  console.error(
    'staging-fixtures failed:',
    error instanceof Error ? error.message.split('\n')[0] : 'unknown error',
  );
  process.exitCode = 1;
});
