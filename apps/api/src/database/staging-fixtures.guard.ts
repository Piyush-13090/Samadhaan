import { isAbsolute, resolve } from 'node:path';

/**
 * Safety checks for the staging fixture script (`staging-fixtures.ts`).
 *
 * The script writes accounts and organisations directly, so it must only ever
 * reach a database that has been positively identified as staging. Each check
 * is independent; any failure refuses the run. Kept free of I/O so every rule
 * is unit-tested.
 */

/** Set once on the staging database by whoever provisions it. */
export const STAGING_DATABASE_MARKER = 'samadhaan:environment=staging';

/** Every fixture lives under these reserved names, and only these are touched. */
export const FIXTURE_EMAIL_DOMAIN = '@samadhaan.test';
export const FIXTURE_EMAIL_PREFIX = 'staging-smoke-';
export const FIXTURE_SLUG_PREFIX = 'staging-smoke-';
export const FIXTURE_NAME_PREFIX = '[staging smoke]';
export const FIXTURE_DESCRIPTION =
  'Synthetic staging smoke-test fixture created by staging-fixtures. Not a real organisation.';

export interface StagingTargetInput {
  /** `SAMADHAAN_DEPLOY_ENV`. Not NODE_ENV: staging runs NODE_ENV=production. */
  deployEnv: string | undefined;
  /** `STAGING_DATABASE_URL`. `DATABASE_URL` is deliberately not read. */
  databaseUrl: string | undefined;
  /** `--confirm-database=<name>`. */
  confirmDatabase: string | undefined;
}

export interface StagingDatabaseFacts {
  /** `current_database()` on the connected server. */
  name: string;
  /** The database's COMMENT (`shobj_description`), or null. */
  comment: string | null;
}

/** Checks that need no connection. Returns the reasons to refuse; empty means go. */
export function preflightProblems(input: StagingTargetInput): string[] {
  const problems: string[] = [];
  if (input.deployEnv !== 'staging') {
    problems.push(
      `SAMADHAAN_DEPLOY_ENV must be exactly "staging" (got ${input.deployEnv ? `"${input.deployEnv}"` : 'nothing'}).`,
    );
  }
  if (!input.databaseUrl) {
    problems.push(
      'STAGING_DATABASE_URL is not set. DATABASE_URL is never used by this script.',
    );
  } else if (!/^postgres(ql)?:\/\//.test(input.databaseUrl)) {
    problems.push('STAGING_DATABASE_URL is not a postgresql:// URL.');
  }
  if (!input.confirmDatabase) {
    problems.push('Pass --confirm-database=<name of the staging database>.');
  }
  return problems;
}

/** Checks against the connected database. Returns the reasons to refuse. */
export function databaseProblems(
  input: StagingTargetInput,
  facts: StagingDatabaseFacts,
): string[] {
  const problems: string[] = [];
  if (facts.name !== input.confirmDatabase) {
    problems.push(
      `Connected to database "${facts.name}", but --confirm-database names "${input.confirmDatabase}".`,
    );
  }
  if (facts.comment?.trim() !== STAGING_DATABASE_MARKER) {
    problems.push(
      `Database "${facts.name}" is not marked as staging. If, and only if, it is the ` +
        `staging database, its owner marks it once with: ` +
        `COMMENT ON DATABASE <staging database> IS '${STAGING_DATABASE_MARKER}';`,
    );
  }
  if (/prod/i.test(facts.name) || /prod/i.test(facts.comment ?? '')) {
    problems.push(`Database "${facts.name}" looks like production.`);
  }
  return problems;
}

/** True for an email this script owns. */
export function isFixtureEmail(email: string): boolean {
  return email.startsWith(FIXTURE_EMAIL_PREFIX) && email.endsWith(FIXTURE_EMAIL_DOMAIN);
}

/**
 * The credentials file must be an absolute path outside any Git working tree,
 * so the generated passwords can't be committed by accident.
 */
export function credentialsPathProblems(
  path: string | undefined,
  isInsideGitWorkTree: (absolutePath: string) => boolean,
): string[] {
  if (!path) return ['Pass --credentials-out=<absolute path outside the repository>.'];
  if (!isAbsolute(path)) return ['--credentials-out must be an absolute path.'];
  if (isInsideGitWorkTree(resolve(path))) {
    return ['--credentials-out is inside a Git working tree; choose a path outside it.'];
  }
  return [];
}
