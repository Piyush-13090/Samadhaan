import { describe, expect, it } from 'vitest';
import {
  STAGING_DATABASE_MARKER,
  credentialsPathProblems,
  databaseProblems,
  isFixtureEmail,
  preflightProblems,
  type StagingTargetInput,
} from './staging-fixtures.guard.js';

const OK: StagingTargetInput = {
  deployEnv: 'staging',
  databaseUrl: 'postgresql://app:secret@db.staging.internal:5432/samadhaan_staging',
  confirmDatabase: 'samadhaan_staging',
};
const MARKED = { name: 'samadhaan_staging', comment: STAGING_DATABASE_MARKER };

describe('staging fixture guard', () => {
  it('accepts an explicitly identified, marked staging database', () => {
    expect(preflightProblems(OK)).toEqual([]);
    expect(databaseProblems(OK, MARKED)).toEqual([]);
  });

  it.each([undefined, '', 'production', 'prod', 'development', 'Staging', 'staging '])(
    'refuses SAMADHAAN_DEPLOY_ENV=%j',
    (deployEnv) => {
      expect(preflightProblems({ ...OK, deployEnv })).toHaveLength(1);
    },
  );

  it('never falls back to DATABASE_URL', () => {
    const problems = preflightProblems({ ...OK, databaseUrl: undefined });
    expect(problems.join()).toMatch(/STAGING_DATABASE_URL is not set/);
  });

  it('refuses a non-PostgreSQL URL and a missing confirmation', () => {
    expect(preflightProblems({ ...OK, databaseUrl: 'mysql://x/y' })).toHaveLength(1);
    expect(preflightProblems({ ...OK, confirmDatabase: undefined })).toHaveLength(1);
  });

  it('refuses when the connected database is not the one confirmed', () => {
    const problems = databaseProblems(OK, { ...MARKED, name: 'samadhaan' });
    expect(problems.join()).toMatch(/Connected to database "samadhaan"/);
  });

  it('refuses a database without the staging marker', () => {
    expect(databaseProblems(OK, { ...MARKED, comment: null }).join()).toMatch(
      /not marked as staging/,
    );
    expect(
      databaseProblems(OK, { ...MARKED, comment: 'samadhaan:environment=production' }),
    ).toHaveLength(2);
  });

  it('refuses anything that looks like production, even if marked', () => {
    const named = { ...OK, confirmDatabase: 'samadhaan_prod' };
    expect(databaseProblems(named, { ...MARKED, name: 'samadhaan_prod' }).join()).toMatch(
      /looks like production/,
    );
  });

  it('owns only reserved fixture emails', () => {
    expect(isFixtureEmail('staging-smoke-citizen@samadhaan.test')).toBe(true);
    expect(isFixtureEmail('citizen@samadhaan.dev')).toBe(false);
    expect(isFixtureEmail('staging-smoke-x@gmail.com')).toBe(false);
    expect(isFixtureEmail('person@samadhaan.test')).toBe(false);
  });

  it('keeps the credentials file out of Git working trees', () => {
    const never = () => false;
    const always = () => true;
    expect(credentialsPathProblems(undefined, never)).toHaveLength(1);
    expect(credentialsPathProblems('smoke.env', never).join()).toMatch(/absolute/);
    expect(credentialsPathProblems('/repo/smoke.env', always).join()).toMatch(/Git/);
    expect(credentialsPathProblems('/secure/smoke.env', never)).toEqual([]);
  });
});
