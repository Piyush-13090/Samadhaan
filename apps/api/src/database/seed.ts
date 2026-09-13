/**
 * Development seed — accounts, organisations and a small civic dataset.
 *
 * ⚠️  DEVELOPMENT ONLY. The accounts share a well-known password published in
 * the README. They must never exist anywhere reachable from the internet.
 *
 * Two independent guards, so no single misconfigured variable is enough:
 *   1. `NODE_ENV` must not be `production`.
 *   2. `ALLOW_DEV_SEED` must be exactly `true`.
 *
 * **Deterministic and idempotent.** Dates derive from a fixed epoch and new rows
 * get fixed UUIDs, so a clean database always ends up identical. Accounts are
 * matched on email rather than id, because earlier seeds created them with
 * random ids — the real id is read back and used for every relation, so the
 * seed reconciles instead of failing on a pre-existing database.
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

/**
 * Fixed reference instant, so relative dates are stable across runs.
 * 2026-09-01T09:00:00Z.
 */
const EPOCH = new Date('2026-09-01T09:00:00.000Z').getTime();
const daysAfterEpoch = (days: number) => new Date(EPOCH + days * 86_400_000);

/** Deterministic UUIDs: readable prefix + a stable suffix. */
const id = (prefix: string, n: number) =>
  `${prefix.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;

const USER_ID = (n: number) => id('11111111', n);
const ORG_ID = (n: number) => id('22222222', n);
const PROBLEM_ID = (n: number) => id('33333333', n);
const IMAGE_ID = (n: number) => id('44444444', n);
const ANALYSIS_ID = (n: number) => id('55555555', n);
const COMMENT_ID = (n: number) => id('66666666', n);
const SUGGESTION_ID = (n: number) => id('77777777', n);
const DUPLICATE_ID = (n: number) => id('88888888', n);
const MEMBER_ID = (n: number) => id('99999999', n);

// ---------------------------------------------------------------------------
// Accounts — one per role, plus extra citizens so engagement looks real.
// ---------------------------------------------------------------------------
const ACCOUNTS = [
  {
    n: 1,
    email: 'citizen@samadhaan.dev',
    fullName: 'Priya Sharma',
    displayName: 'priya',
    role: 'CITIZEN',
    bio: 'Resident of Sector 12. Interested in drainage and pedestrian safety.',
  },
  {
    n: 2,
    email: 'ngo@samadhaan.dev',
    fullName: 'Vikram Rao',
    displayName: 'vikram',
    role: 'NGO',
    bio: 'Programme lead at Clean City Foundation, working on sanitation and drainage.',
  },
  {
    n: 3,
    email: 'university@samadhaan.dev',
    fullName: 'Dr Anita Menon',
    displayName: 'anita',
    role: 'UNIVERSITY',
    bio: 'Researcher in urban water systems and flood mapping.',
  },
  {
    n: 4,
    email: 'industry@samadhaan.dev',
    fullName: 'Rohan Kapoor',
    displayName: 'rohan',
    role: 'INDUSTRY',
    bio: 'Operations lead, road repair and street lighting.',
  },
  {
    n: 5,
    email: 'government@samadhaan.dev',
    fullName: 'S. Krishnan',
    displayName: 'krishnan',
    role: 'GOVERNMENT',
    bio: 'Ward 12 Municipal Office.',
  },
  {
    n: 6,
    email: 'admin@samadhaan.dev',
    fullName: 'Platform Admin',
    displayName: 'admin',
    role: 'ADMIN',
    bio: null,
  },
  {
    n: 7,
    email: 'citizen2@samadhaan.dev',
    fullName: 'Arjun Mehta',
    displayName: 'arjun',
    role: 'CITIZEN',
    bio: 'Reports road and traffic problems around Main Market.',
  },
  {
    n: 8,
    email: 'citizen3@samadhaan.dev',
    fullName: 'Fatima Khan',
    displayName: 'fatima',
    role: 'CITIZEN',
    bio: null,
  },
] as const;

const ORGANIZATIONS = [
  {
    n: 1,
    name: 'Clean City Foundation',
    slug: 'clean-city-foundation',
    type: 'NGO',
    description: 'Sanitation and drainage work across the northern wards.',
    city: 'Gurugram',
    state: 'Haryana',
    latitude: 28.4595,
    longitude: 77.0266,
    verificationStatus: 'VERIFIED',
    ownerUser: 2,
  },
  {
    n: 2,
    name: 'Institute of Urban Systems',
    slug: 'institute-of-urban-systems',
    type: 'UNIVERSITY',
    description: 'Urban water research and flood mapping.',
    city: 'Gurugram',
    state: 'Haryana',
    latitude: 28.4721,
    longitude: 77.0891,
    verificationStatus: 'VERIFIED',
    ownerUser: 3,
  },
  {
    n: 3,
    name: 'Meridian Infrastructure',
    slug: 'meridian-infrastructure',
    type: 'INDUSTRY',
    description: 'Road repair and street lighting contractor.',
    city: 'Gurugram',
    state: 'Haryana',
    latitude: 28.4402,
    longitude: 77.0512,
    verificationStatus: 'PENDING',
    ownerUser: 4,
  },
  {
    n: 4,
    name: 'Ward 12 Municipal Office',
    slug: 'ward-12-municipal-office',
    type: 'GOVERNMENT',
    description: 'Local authority for Ward 12.',
    city: 'Gurugram',
    state: 'Haryana',
    latitude: 28.4589,
    longitude: 77.0301,
    verificationStatus: 'VERIFIED',
    ownerUser: 5,
  },
] as const;

// ---------------------------------------------------------------------------
// Problems. Coordinates are real Gurugram locations so PostGIS radius queries
// return believable distances; the reports themselves are invented.
// ---------------------------------------------------------------------------
const PROBLEMS = [
  {
    n: 1,
    reporter: 1,
    title: 'Waterlogging near Sector 12 market',
    description:
      'Water has been standing at the market entrance for three days after the last rain. Shopkeepers are laying planks across the road and two people have slipped.',
    category: 'DRAINAGE',
    subcategory: 'Blocked stormwater drain',
    status: 'IN_PROGRESS',
    severity: 'HIGH',
    urgency: 'HIGH',
    priorityScore: 78.5,
    address: 'Sector 12 Market Road, near Bus Stop 4',
    city: 'Gurugram',
    state: 'Haryana',
    postalCode: '122001',
    latitude: 28.4595,
    longitude: 77.0266,
    daysAgo: 6,
    voteCount: 342,
    commentCount: 2,
    followCount: 51,
  },
  {
    n: 2,
    reporter: 8,
    title: 'Broken streetlight near Community Park',
    description:
      'The light at the park north gate has been out for two weeks. The path is completely dark after 7pm and is used by people walking home.',
    category: 'STREETLIGHTS',
    subcategory: 'Non-functioning lamp',
    status: 'SUBMITTED',
    severity: 'MEDIUM',
    urgency: 'MEDIUM',
    priorityScore: 41.0,
    address: 'Community Park, North Gate',
    city: 'Gurugram',
    state: 'Haryana',
    postalCode: '122002',
    latitude: 28.4667,
    longitude: 77.0312,
    daysAgo: 2,
    voteCount: 87,
    commentCount: 0,
    followCount: 12,
  },
  {
    n: 3,
    reporter: 7,
    title: 'Large pothole near Main Market crossing',
    description:
      'A pothole roughly two feet wide has opened at the crossing. Two-wheelers are swerving into the opposite lane to avoid it.',
    category: 'POTHOLES',
    subcategory: 'Road surface failure',
    status: 'UNDER_REVIEW',
    severity: 'HIGH',
    urgency: 'HIGH',
    priorityScore: 71.2,
    address: 'Main Market Crossing, opposite State Bank',
    city: 'Gurugram',
    state: 'Haryana',
    postalCode: '122001',
    latitude: 28.4603,
    longitude: 77.0248,
    daysAgo: 1,
    voteCount: 214,
    commentCount: 0,
    followCount: 33,
  },
  {
    n: 4,
    reporter: 1,
    title: 'Garbage accumulation near Block B',
    description:
      'The collection point behind Block B has not been cleared in over a week. It has started to smell and stray animals are scattering waste onto the footpath.',
    category: 'GARBAGE',
    subcategory: 'Uncollected waste',
    status: 'RESOLVED',
    severity: 'MEDIUM',
    urgency: 'MEDIUM',
    priorityScore: 38.0,
    address: 'Block B service lane',
    city: 'Gurugram',
    state: 'Haryana',
    postalCode: '122003',
    latitude: 28.4711,
    longitude: 77.0389,
    daysAgo: 14,
    resolvedDaysAgo: 2,
    voteCount: 156,
    commentCount: 0,
    followCount: 24,
  },
  {
    n: 5,
    reporter: 7,
    title: 'Missing manhole cover on Link Road',
    description:
      'An open manhole on the footpath outside the clinic. Someone has put a branch in it as a warning but it is not visible at night.',
    category: 'PUBLIC_SAFETY',
    subcategory: 'Open drain access',
    status: 'VERIFIED',
    severity: 'CRITICAL',
    urgency: 'CRITICAL',
    priorityScore: 94.0,
    address: 'Link Road, outside Sector 12 clinic',
    city: 'Gurugram',
    state: 'Haryana',
    postalCode: '122001',
    latitude: 28.4588,
    longitude: 77.0271,
    daysAgo: 1,
    voteCount: 498,
    commentCount: 0,
    followCount: 88,
  },
  {
    // Deliberately near problem 1 and in the same category, so the duplicate
    // candidate below has a realistic basis.
    n: 6,
    reporter: 8,
    title: 'Water standing outside Sector 12 shops',
    description:
      'Rainwater is not draining outside the shops near the Sector 12 bus stop. It has been like this for several days.',
    category: 'DRAINAGE',
    subcategory: 'Blocked stormwater drain',
    status: 'SUBMITTED',
    severity: 'HIGH',
    urgency: 'MEDIUM',
    priorityScore: 52.0,
    address: 'Sector 12 Market, shop row near bus stop',
    city: 'Gurugram',
    state: 'Haryana',
    postalCode: '122001',
    latitude: 28.4597,
    longitude: 77.0269,
    daysAgo: 3,
    voteCount: 18,
    commentCount: 0,
    followCount: 4,
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

    // --- Users ------------------------------------------------------------
    // Matched on email: an account seeded before this milestone already exists
    // with a random id, and the unique email constraint means we must reuse the
    // existing row rather than insert a second one.
    const userId = new Map<number, string>();

    for (const account of ACCOUNTS) {
      const user = await prisma.user.upsert({
        where: { email: account.email },
        update: {
          passwordHash,
          fullName: account.fullName,
          role: account.role,
          status: 'ACTIVE',
          // Profile fields are refreshed on re-seed too, so an existing
          // development database picks them up rather than only new ones.
          bio: account.bio,
          city: 'Gurugram',
          state: 'Haryana',
          country: 'India',
        },
        create: {
          id: USER_ID(account.n),
          email: account.email,
          passwordHash,
          fullName: account.fullName,
          displayName: account.displayName,
          role: account.role,
          status: 'ACTIVE',
          emailVerifiedAt: daysAfterEpoch(-30),
          bio: account.bio,
          city: 'Gurugram',
          state: 'Haryana',
          country: 'India',
        },
      });

      // Whatever id the row actually has is what every relation below uses.
      userId.set(account.n, user.id);
    }
    console.log(`  ✓ ${ACCOUNTS.length} users`);

    /** Resolves a seed account number to its real database id. */
    const uid = (n: number): string => {
      const resolved = userId.get(n);
      if (!resolved) throw new Error(`Seed account ${n} was not created.`);
      return resolved;
    };

    // --- Organisations, each with its owner as a member --------------------
    for (const org of ORGANIZATIONS) {
      await prisma.organization.upsert({
        where: { slug: org.slug },
        update: { name: org.name, verificationStatus: org.verificationStatus },
        create: {
          id: ORG_ID(org.n),
          name: org.name,
          slug: org.slug,
          type: org.type,
          description: org.description,
          email: `contact@${org.slug}.example`,
          city: org.city,
          state: org.state,
          country: 'India',
          latitude: org.latitude,
          longitude: org.longitude,
          verificationStatus: org.verificationStatus,
          verifiedAt: org.verificationStatus === 'VERIFIED' ? daysAfterEpoch(-20) : null,
        },
      });

      await prisma.organizationMember.upsert({
        where: {
          organizationId_userId: {
            organizationId: ORG_ID(org.n),
            userId: uid(org.ownerUser),
          },
        },
        update: { membershipRole: 'OWNER', status: 'ACTIVE' },
        create: {
          id: MEMBER_ID(org.n),
          organizationId: ORG_ID(org.n),
          userId: uid(org.ownerUser),
          membershipRole: 'OWNER',
          status: 'ACTIVE',
          joinedAt: daysAfterEpoch(-20),
        },
      });
    }

    // A researcher who also advises an NGO — proves membership is many-to-many
    // rather than a single column on `User`.
    await prisma.organizationMember.upsert({
      where: {
        organizationId_userId: { organizationId: ORG_ID(1), userId: uid(3) },
      },
      update: { membershipRole: 'MEMBER', status: 'ACTIVE' },
      create: {
        id: MEMBER_ID(90),
        organizationId: ORG_ID(1),
        userId: uid(3),
        membershipRole: 'MEMBER',
        status: 'ACTIVE',
        joinedAt: daysAfterEpoch(-10),
      },
    });
    console.log(
      `  ✓ ${ORGANIZATIONS.length} organisations, ${ORGANIZATIONS.length + 1} memberships`,
    );

    // --- Organisation expertise -------------------------------------------
    // Reuses ProblemCategory, so the future matcher compares like with like.
    const EXPERTISE = [
      {
        org: 1,
        category: 'DRAINAGE',
        subcategory: 'Stormwater drainage',
        level: 'SPECIALIST',
      },
      { org: 1, category: 'SANITATION', subcategory: null, level: 'SPECIALIST' },
      {
        org: 1,
        category: 'GARBAGE',
        subcategory: 'Collection points',
        level: 'EXPERIENCED',
      },
      {
        org: 2,
        category: 'WATER',
        subcategory: 'Urban water systems',
        level: 'SPECIALIST',
      },
      {
        org: 2,
        category: 'DRAINAGE',
        subcategory: 'Flood mapping',
        level: 'EXPERIENCED',
      },
      {
        org: 2,
        category: 'PUBLIC_INFRASTRUCTURE',
        subcategory: 'Urban planning research',
        level: 'INTERESTED',
      },
      { org: 3, category: 'ROADS', subcategory: 'Resurfacing', level: 'SPECIALIST' },
      { org: 3, category: 'POTHOLES', subcategory: null, level: 'SPECIALIST' },
      {
        org: 3,
        category: 'STREETLIGHTS',
        subcategory: 'LED retrofits',
        level: 'EXPERIENCED',
      },
      { org: 4, category: 'PUBLIC_SAFETY', subcategory: null, level: 'EXPERIENCED' },
    ] as const;

    for (const entry of EXPERTISE) {
      await prisma.organizationExpertise.upsert({
        where: {
          organizationId_category: {
            organizationId: ORG_ID(entry.org),
            category: entry.category,
          },
        },
        update: { subcategory: entry.subcategory, level: entry.level },
        create: {
          organizationId: ORG_ID(entry.org),
          category: entry.category,
          subcategory: entry.subcategory,
          level: entry.level,
          addedById: uid(ORGANIZATIONS[entry.org - 1]!.ownerUser),
        },
      });
    }
    console.log(`  ✓ ${EXPERTISE.length} expertise entries`);

    // --- Problems ---------------------------------------------------------
    for (const problem of PROBLEMS) {
      const reportedAt = daysAfterEpoch(-problem.daysAgo);

      await prisma.problem.upsert({
        where: { id: PROBLEM_ID(problem.n) },
        update: { status: problem.status, priorityScore: problem.priorityScore },
        create: {
          id: PROBLEM_ID(problem.n),
          // publicId is left to the database sequence, which is the whole point
          // of that default — the seed must not hand-assign it.
          reporterId: uid(problem.reporter),
          title: problem.title,
          description: problem.description,
          category: problem.category,
          subcategory: problem.subcategory,
          status: problem.status,
          severity: problem.severity,
          urgency: problem.urgency,
          priorityScore: problem.priorityScore,
          address: problem.address,
          city: problem.city,
          state: problem.state,
          country: 'India',
          postalCode: problem.postalCode,
          latitude: problem.latitude,
          longitude: problem.longitude,
          locationAccuracyM: 12,
          voteCount: problem.voteCount,
          commentCount: problem.commentCount,
          followCount: problem.followCount,
          submittedAt: reportedAt,
          resolvedAt:
            'resolvedDaysAgo' in problem
              ? daysAfterEpoch(-(problem.resolvedDaysAgo as number))
              : null,
          createdAt: reportedAt,
        },
      });
    }
    console.log(`  ✓ ${PROBLEMS.length} problems`);

    // --- Images. Object keys only; no binary data in PostgreSQL. -----------
    const images = [
      { n: 1, problem: 1, kind: 'BEFORE', primary: true },
      { n: 2, problem: 1, kind: 'PROGRESS', primary: false },
      { n: 3, problem: 3, kind: 'BEFORE', primary: true },
      { n: 4, problem: 4, kind: 'BEFORE', primary: true },
      { n: 5, problem: 4, kind: 'AFTER', primary: false },
      { n: 6, problem: 5, kind: 'BEFORE', primary: true },
    ] as const;

    for (const image of images) {
      const key = `dev/problems/${PROBLEM_ID(image.problem)}/${image.kind.toLowerCase()}-${image.n}.jpg`;

      await prisma.problemImage.upsert({
        where: { storageKey: key },
        update: {},
        create: {
          id: IMAGE_ID(image.n),
          problemId: PROBLEM_ID(image.problem),
          storageKey: key,
          url: null,
          originalFileName: `photo-${image.n}.jpg`,
          mimeType: 'image/jpeg',
          fileSize: 1_248_000 + image.n * 1000,
          width: 1920,
          height: 1080,
          kind: image.kind,
          sortOrder: image.n,
          isPrimary: image.primary,
        },
      });
    }
    console.log(`  ✓ ${images.length} problem images`);

    // --- AI analyses. Illustrative records; no model was run. --------------
    const analyses = [
      {
        n: 1,
        problem: 1,
        category: 'DRAINAGE',
        severity: 'HIGH',
        urgency: 'HIGH',
        severityScore: 8.7,
        confidence: 0.94,
        summary:
          'Standing water across a pedestrian route, with a blocked stormwater drain visible at the kerb.',
      },
      {
        n: 2,
        problem: 3,
        category: 'POTHOLES',
        severity: 'HIGH',
        urgency: 'HIGH',
        severityScore: 7.9,
        confidence: 0.96,
        summary:
          'Road surface failure at a high-traffic junction; vehicles are changing lanes to avoid it.',
      },
      {
        n: 3,
        problem: 5,
        category: 'PUBLIC_SAFETY',
        severity: 'CRITICAL',
        urgency: 'CRITICAL',
        severityScore: 9.4,
        confidence: 0.97,
        summary:
          'Open drain access on a footpath beside a clinic entrance. Immediate fall risk, unlit after dark.',
      },
    ] as const;

    for (const analysis of analyses) {
      await prisma.problemAiAnalysis.upsert({
        where: { id: ANALYSIS_ID(analysis.n) },
        update: {},
        create: {
          id: ANALYSIS_ID(analysis.n),
          problemId: PROBLEM_ID(analysis.problem),
          modelName: 'seed-placeholder',
          modelVersion: '0.0.0-dev',
          analysisType: 'INITIAL_ANALYSIS',
          category: analysis.category,
          severity: analysis.severity,
          urgency: analysis.urgency,
          severityScore: analysis.severityScore,
          confidence: analysis.confidence,
          summary: analysis.summary,
          processingStatus: 'COMPLETED',
          processingMs: 2400,
          rawResult: {
            note: 'Development fixture. No model was invoked to produce this.',
            observations: [analysis.summary],
          },
        },
      });
    }

    // One pending job, so the queue index has something to exercise.
    await prisma.problemAiAnalysis.upsert({
      where: { id: ANALYSIS_ID(4) },
      update: {},
      create: {
        id: ANALYSIS_ID(4),
        problemId: PROBLEM_ID(6),
        modelName: 'seed-placeholder',
        modelVersion: '0.0.0-dev',
        analysisType: 'INITIAL_ANALYSIS',
        processingStatus: 'PENDING',
      },
    });
    console.log(`  ✓ ${analyses.length + 1} AI analyses`);

    // --- Votes and follows -------------------------------------------------
    const engagements = [
      { problem: 1, users: [7, 8, 3] },
      { problem: 3, users: [1, 8] },
      { problem: 5, users: [1, 7, 8] },
      { problem: 4, users: [7] },
    ] as const;

    let voteCount = 0;
    let followCount = 0;

    for (const engagement of engagements) {
      for (const user of engagement.users) {
        await prisma.problemVote.upsert({
          where: {
            problemId_userId: {
              problemId: PROBLEM_ID(engagement.problem),
              userId: uid(user),
            },
          },
          update: {},
          create: {
            problemId: PROBLEM_ID(engagement.problem),
            userId: uid(user),
          },
        });
        voteCount += 1;
      }

      // Reporters follow their own reports; the first supporter follows too.
      const follower = engagement.users[0];
      await prisma.problemFollow.upsert({
        where: {
          problemId_userId: {
            problemId: PROBLEM_ID(engagement.problem),
            userId: uid(follower),
          },
        },
        update: {},
        create: {
          problemId: PROBLEM_ID(engagement.problem),
          userId: uid(follower),
        },
      });
      followCount += 1;
    }
    console.log(`  ✓ ${voteCount} votes, ${followCount} follows`);

    // --- Threaded comments -------------------------------------------------
    await prisma.problemComment.upsert({
      where: { id: COMMENT_ID(1) },
      update: {},
      create: {
        id: COMMENT_ID(1),
        problemId: PROBLEM_ID(1),
        userId: uid(8),
        body: 'This has happened every monsoon for the last three years. Good to finally see it tracked properly.',
        createdAt: daysAfterEpoch(-5),
      },
    });

    // A reply, proving the adjacency-list thread works.
    await prisma.problemComment.upsert({
      where: { id: COMMENT_ID(2) },
      update: {},
      create: {
        id: COMMENT_ID(2),
        problemId: PROBLEM_ID(1),
        userId: uid(2),
        parentCommentId: COMMENT_ID(1),
        body: 'Clean City Foundation is clearing the junction box this week. We will post photos as we go.',
        createdAt: daysAfterEpoch(-4),
      },
    });

    await prisma.problemComment.upsert({
      where: { id: COMMENT_ID(3) },
      update: {},
      create: {
        id: COMMENT_ID(3),
        problemId: PROBLEM_ID(1),
        userId: uid(7),
        body: 'Walked past this morning — the water level has dropped noticeably since the clearing started.',
        createdAt: daysAfterEpoch(-1),
      },
    });
    console.log('  ✓ 3 comments (one threaded reply)');

    // --- Suggestions: one from an organisation, one from a citizen ---------
    await prisma.problemSuggestion.upsert({
      where: { id: SUGGESTION_ID(1) },
      update: {},
      create: {
        id: SUGGESTION_ID(1),
        problemId: PROBLEM_ID(1),
        authorId: uid(2),
        organizationId: ORG_ID(1),
        title: 'Clear the junction box before the main drain',
        description:
          'The blockage is at the junction box, not the main drain. Clearing that first would drain the standing water within a day, before any longer-term work.',
        status: 'ACCEPTED',
        reviewedById: uid(5),
        reviewedAt: daysAfterEpoch(-4),
        endorsementCount: 64,
        createdAt: daysAfterEpoch(-5),
      },
    });

    await prisma.problemSuggestion.upsert({
      where: { id: SUGGESTION_ID(2) },
      update: {},
      create: {
        id: SUGGESTION_ID(2),
        problemId: PROBLEM_ID(1),
        authorId: uid(8),
        title: 'Temporary raised walkway at the market entrance',
        description:
          'A temporary raised walkway would keep the footpath usable while the drainage work happens.',
        status: 'PENDING',
        endorsementCount: 41,
        createdAt: daysAfterEpoch(-4),
      },
    });
    console.log('  ✓ 2 suggestions (one organisation-backed, one citizen)');

    // --- Duplicate candidate ----------------------------------------------
    // Direction matters: the NEWER report (6) is checked against the OLDER (1).
    await prisma.problemDuplicateCandidate.upsert({
      where: {
        problemId_candidateProblemId: {
          problemId: PROBLEM_ID(6),
          candidateProblemId: PROBLEM_ID(1),
        },
      },
      update: {},
      create: {
        id: DUPLICATE_ID(1),
        problemId: PROBLEM_ID(6),
        candidateProblemId: PROBLEM_ID(1),
        textSimilarity: 0.89,
        imageSimilarity: null,
        geographicSimilarity: 0.98,
        categorySimilarity: 1.0,
        combinedScore: 0.92,
        confidence: 0.9,
        status: 'LIKELY_DUPLICATE',
      },
    });
    console.log('  ✓ 1 duplicate candidate (problem 6 → problem 1)');

    // --- Audit log ---------------------------------------------------------
    await prisma.auditLog.createMany({
      data: [
        {
          actorUserId: uid(5),
          action: 'ORGANIZATION_VERIFIED',
          entityType: 'Organization',
          entityId: ORG_ID(1),
          metadata: { from: 'PENDING', to: 'VERIFIED' },
        },
        {
          actorUserId: uid(5),
          action: 'PROBLEM_STATUS_CHANGED',
          entityType: 'Problem',
          entityId: PROBLEM_ID(1),
          metadata: { from: 'UNDER_REVIEW', to: 'IN_PROGRESS' },
        },
      ],
      skipDuplicates: true,
    });
    console.log('  ✓ 2 audit entries');

    const publicIds = await prisma.problem.findMany({
      select: { publicId: true },
      orderBy: { publicId: 'asc' },
    });

    console.log(
      `\nSeeded development data. Problem references: ${publicIds
        .map((p) => p.publicId)
        .join(', ')}`,
    );
    console.log(
      'Password for all accounts is documented in the README (development only).',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
