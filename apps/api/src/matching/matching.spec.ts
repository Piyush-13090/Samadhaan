import { describe, expect, it } from 'vitest';
import { parseMatchResponse } from '../ai/dto/matching.dto.js';
import { toMatchEvidence } from './match.serializer.js';
import {
  buildOrganizationProfileText,
  profileSourceHash,
} from './organization-profile-text.js';

const response = (overrides: Record<string, unknown> = {}) => ({
  matches: [
    {
      organization_id: 'org-a',
      rank: 1,
      final_score: 0.82,
      signals: {
        semantic: 0.9,
        expertise: 1,
        category: 1,
        geographic: 0.5,
        capability: null,
        activity: 0.5,
      },
      reasons: [{ code: 'EXPERTISE_STRONG', signal: 'expertise', value: 1 }],
      matched_expertise: [0],
    },
  ],
  considered: 3,
  degraded: ['capability'],
  model: {
    engine: 'heuristic-baseline',
    engine_version: '1.0.0',
    matching_version: 'heuristic-baseline@1.0.0+abc1234',
    weights: { semantic: 0.35 },
    embedding_model: 'all-MiniLM-L6-v2',
    trained: false,
  },
  processing_ms: 4,
  ...overrides,
});

describe('parseMatchResponse', () => {
  const candidates = new Set(['org-a', 'org-b']);

  it('accepts a well-formed response and converts it to camelCase', () => {
    const parsed = parseMatchResponse(response(), candidates)!;
    expect(parsed.matchingVersion).toBe('heuristic-baseline@1.0.0+abc1234');
    expect(parsed.trained).toBe(false);
    expect(parsed.matches[0]).toMatchObject({
      organizationId: 'org-a',
      finalScore: 0.82,
      matchedExpertise: [0],
    });
  });

  it.each([
    ['an organisation that was never a candidate', { organization_id: 'org-z' }],
    ['a score above one', { final_score: 1.4 }],
    ['a negative signal', { signals: { semantic: -0.2 } }],
    [
      'an unknown reason code',
      { reasons: [{ code: 'BIG_DONOR', signal: 'x', value: 1 }] },
    ],
  ])('rejects %s', (_label, change) => {
    const bad = response();
    Object.assign((bad.matches as Array<Record<string, unknown>>)[0]!, change);
    expect(parseMatchResponse(bad, candidates)).toBeNull();
  });

  it('rejects the same organisation twice, and a missing model block', () => {
    const twice = response();
    twice.matches = [...twice.matches, ...twice.matches];
    expect(parseMatchResponse(twice, candidates)).toBeNull();
    expect(parseMatchResponse(response({ model: undefined }), candidates)).toBeNull();
    expect(parseMatchResponse('nonsense', candidates)).toBeNull();
  });
});

describe('organisation profile text', () => {
  const organization = {
    name: 'RoadSafe Foundation',
    type: 'NGO',
    description: 'Road safety advocacy.',
    expertise: [
      { category: 'PUBLIC_INFRASTRUCTURE', subcategory: null },
      { category: 'ROADS', subcategory: 'Road infrastructure' },
    ],
  };

  it('describes what the organisation does, not how to reach it', () => {
    expect(buildOrganizationProfileText(organization)).toBe(
      'RoadSafe Foundation\nOrganisation type: ngo\nRoad safety advocacy.\n' +
        'Areas of work: public infrastructure; roads: Road infrastructure',
    );
  });

  it('hashes identically for identical input and differently for any change', () => {
    const text = buildOrganizationProfileText(organization);
    expect(profileSourceHash(text)).toBe(profileSourceHash(text));
    expect(profileSourceHash(text)).not.toBe(
      profileSourceHash(
        buildOrganizationProfileText({ ...organization, description: 'Road safety.' }),
      ),
    );
  });
});

describe('toMatchEvidence', () => {
  it('publishes signals, reasons and matched expertise, and drops anything unknown', () => {
    const evidence = toMatchEvidence({
      semanticScore: 0.91234,
      expertiseScore: 1,
      categoryScore: 1,
      geographicScore: null,
      capabilityScore: null,
      activityScore: 0.5,
      finalScore: 0.8766,
      rank: 2,
      explanation: {
        reasons: [
          { code: 'EXPERTISE_STRONG', value: 1 },
          { code: 'INJECTED', value: 9 },
        ],
        matchedExpertise: [{ category: 'ROADS', subcategory: null, level: 'SPECIALIST' }],
        internal: 'not published',
      },
      updatedAt: new Date('2026-10-07T00:00:00Z'),
    });

    expect(evidence).toEqual({
      relevance: 0.877,
      rank: 2,
      signals: {
        semantic: 0.912,
        expertise: 1,
        category: 1,
        geographic: null,
        capability: null,
        activity: 0.5,
      },
      reasons: [{ code: 'EXPERTISE_STRONG', value: 1 }],
      matchedExpertise: [{ category: 'ROADS', subcategory: null, level: 'SPECIALIST' }],
      computedAt: '2026-10-07T00:00:00.000Z',
    });
  });
});
