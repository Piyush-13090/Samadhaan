import sharp from 'sharp';
import { canTransitionEvidence, EVIDENCE_STATUSES } from '@samadhaan/shared';
import { describe, expect, it } from 'vitest';
import { parseVerificationResponse } from '../ai/dto/verification.dto.js';
import { hrefFor } from '../notifications/notification-metadata.js';
import { planNotifications } from '../notifications/notification-planner.js';
import {
  detectEvidenceType,
  extensionMatches,
  processImage,
  readExif,
  safeFileName,
} from './evidence-files.js';
import {
  QUALITY_WEIGHTS,
  completeness,
  differenceHash,
  evidenceQuality,
  hammingDistance,
  imageQuality,
  locationConsistency,
  missingEvidence,
  recommend,
  temporalConsistency,
  type Signal,
} from './verification-scoring.js';

const NULL: Signal = { value: null, confidence: 0, source: '' };

describe('evidence lifecycle', () => {
  it('allows only the documented transitions', () => {
    expect(canTransitionEvidence('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransitionEvidence('SUBMITTED', 'PROCESSING')).toBe(true);
    expect(canTransitionEvidence('PROCESSING', 'AI_REVIEWED')).toBe(true);
    expect(canTransitionEvidence('AI_REVIEWED', 'UNDER_GOVERNMENT_REVIEW')).toBe(true);
    expect(canTransitionEvidence('UNDER_GOVERNMENT_REVIEW', 'APPROVED')).toBe(true);
    expect(canTransitionEvidence('UNDER_GOVERNMENT_REVIEW', 'NEEDS_MORE_EVIDENCE')).toBe(
      true,
    );
    expect(canTransitionEvidence('NEEDS_MORE_EVIDENCE', 'UNDER_GOVERNMENT_REVIEW')).toBe(
      true,
    );
  });

  it('never lets the organisation approve, skip review, or revive a decision', () => {
    expect(canTransitionEvidence('DRAFT', 'APPROVED')).toBe(false);
    expect(canTransitionEvidence('AI_REVIEWED', 'APPROVED')).toBe(false);
    expect(canTransitionEvidence('UNDER_GOVERNMENT_REVIEW', 'WITHDRAWN')).toBe(false);
    for (const final of ['APPROVED', 'REJECTED', 'WITHDRAWN'] as const) {
      for (const to of EVIDENCE_STATUSES)
        expect(canTransitionEvidence(final, to)).toBe(false);
    }
  });
});

describe('deterministic signals', () => {
  it('scores photo GPS against the report, capped in confidence', () => {
    expect(locationConsistency([], 100, 1000).value).toBeNull();
    expect(locationConsistency([40, 900], 100, 1000)).toMatchObject({
      value: 1,
      confidence: 0.5,
    });
    expect(locationConsistency([550], 100, 1000).value).toBeCloseTo(0.5);
    expect(locationConsistency([5000], 100, 1000).value).toBe(0);
  });

  it('checks capture times against the report, with a day of tolerance', () => {
    const reported = new Date('2026-10-01T10:00:00Z');
    const now = new Date('2026-10-07T10:00:00Z');
    expect(temporalConsistency([], reported, now).value).toBeNull();
    const t = temporalConsistency(
      [
        new Date('2026-10-05T10:00:00Z'),
        new Date('2026-09-20T10:00:00Z'),
        new Date('2027-01-01T00:00:00Z'),
      ],
      reported,
      now,
    );
    expect(t).toMatchObject({ early: 1, future: 1, confidence: 0.4 });
    expect(t.value).toBeCloseTo(1 / 3);
    expect(
      temporalConsistency([new Date('2026-09-30T20:00:00Z')], reported, now).early,
    ).toBe(0);
  });

  it('rates image resolution', () => {
    expect(imageQuality([]).value).toBeNull();
    expect(imageQuality([{ width: 1600, height: 1200 }]).value).toBe(1);
    expect(imageQuality([{ width: 360, height: 640 }]).value).toBeCloseTo(0.5);
  });
});

describe('missing evidence', () => {
  const base = { category: 'POTHOLES' as const, reportPhotos: 0, locationNearM: 100 };

  it('lists the category’s expected items, satisfied or not', () => {
    const items = missingEvidence({
      ...base,
      evidence: [
        {
          evidenceType: 'AFTER_IMAGE',
          files: [{ role: 'AFTER', mimeType: 'image/jpeg', locationDistanceM: 30 }],
        },
      ],
    });
    const by = Object.fromEntries(items.map((i) => [i.kind, i.satisfied]));
    expect(by).toEqual({
      AFTER_IMAGE: true,
      BEFORE_IMAGE: false,
      LOCATION: true,
      DOCUMENT: false,
    });
    expect(items.filter((i) => i.required).map((i) => i.kind)).toEqual(['AFTER_IMAGE']);
  });

  it('counts the citizen’s report photo as the before photo', () => {
    const items = missingEvidence({ ...base, reportPhotos: 1, evidence: [] });
    expect(items.find((i) => i.kind === 'BEFORE_IMAGE')).toMatchObject({
      satisfied: true,
      satisfiedBy: 'The citizen’s original report photo',
    });
  });

  it('does not invent requirements: streetlights expect no document', () => {
    const items = missingEvidence({ ...base, category: 'STREETLIGHTS', evidence: [] });
    expect(items.map((i) => i.kind)).toEqual(['AFTER_IMAGE', 'LOCATION']);
  });

  it('weights required items fully and suggestions by half', () => {
    const items = missingEvidence({
      ...base,
      evidence: [
        {
          evidenceType: 'AFTER_IMAGE',
          files: [{ role: 'AFTER', mimeType: 'image/png', locationDistanceM: null }],
        },
      ],
    });
    expect(completeness(items).value).toBeCloseTo(1 / 2.5);
  });
});

describe('evidence quality', () => {
  const signals = (
    overrides: Partial<Record<keyof typeof QUALITY_WEIGHTS, Signal>> = {},
  ) =>
    Object.fromEntries(
      Object.keys(QUALITY_WEIGHTS).map((k) => [
        k,
        overrides[k as keyof typeof QUALITY_WEIGHTS] ?? NULL,
      ]),
    ) as Record<keyof typeof QUALITY_WEIGHTS, Signal>;

  it('is a confidence-weighted mean over available signals, 0–100', () => {
    expect(evidenceQuality(signals())).toBeNull();
    expect(
      evidenceQuality(
        signals({
          relevance: { value: 0.8, confidence: 1, source: '' },
          completionSignals: { value: 0.6, confidence: 1, source: '' },
        }),
      ),
    ).toBeCloseTo(70);
  });

  it('lets an uncertain signal count for less', () => {
    const sure = evidenceQuality(
      signals({
        relevance: { value: 1, confidence: 1, source: '' },
        locationConsistency: { value: 0, confidence: 1, source: '' },
      }),
    )!;
    const unsure = evidenceQuality(
      signals({
        relevance: { value: 1, confidence: 1, source: '' },
        locationConsistency: { value: 0, confidence: 0.2, source: '' },
      }),
    )!;
    expect(unsure).toBeGreaterThan(sure);
  });
});

describe('recommendation guard rules', () => {
  const input = {
    ai: 'LIKELY_RESOLVED' as const,
    aiConfidence: 0.86,
    analysable: true,
    relevance: 0.9,
    location: 0.92,
    concerns: [],
  };

  it('keeps a well-supported recommendation', () => {
    expect(recommend(input)).toEqual({
      recommendation: 'LIKELY_RESOLVED',
      adjustments: [],
    });
  });

  it('claims nothing when no AI review ran', () => {
    expect(recommend({ ...input, ai: null }).recommendation).toBeNull();
  });

  it('only ever moves towards caution, saying why', () => {
    expect(recommend({ ...input, analysable: false }).recommendation).toBe(
      'INSUFFICIENT_EVIDENCE',
    );
    expect(recommend({ ...input, relevance: 0.1 }).recommendation).toBe(
      'INSUFFICIENT_EVIDENCE',
    );
    expect(recommend({ ...input, aiConfidence: 0.3 })).toEqual({
      recommendation: 'POSSIBLY_RESOLVED',
      adjustments: ['The AI review had low confidence.'],
    });
    expect(
      recommend({ ...input, ai: 'LIKELY_NOT_RESOLVED', aiConfidence: 0.2 })
        .recommendation,
    ).toBe('INSUFFICIENT_EVIDENCE');
    expect(recommend({ ...input, location: 0.1 }).recommendation).toBe(
      'POSSIBLY_RESOLVED',
    );
    expect(
      recommend({ ...input, concerns: [{ code: 'AFTER_MATCHES_BEFORE', text: 'x' }] })
        .recommendation,
    ).toBe('POSSIBLY_RESOLVED');
    // Informational concerns do not downgrade.
    expect(
      recommend({ ...input, concerns: [{ code: 'DUPLICATE_UPLOAD', text: 'x' }] })
        .recommendation,
    ).toBe('LIKELY_RESOLVED');
    // Never upgrades.
    expect(recommend({ ...input, ai: 'INSUFFICIENT_EVIDENCE' }).recommendation).toBe(
      'INSUFFICIENT_EVIDENCE',
    );
  });
});

describe('perceptual hashing', () => {
  it('counts differing bits', () => {
    expect(hammingDistance(0n, 0n)).toBe(0);
    expect(hammingDistance(0b1011n, 0b0001n)).toBe(2);
    expect(hammingDistance(-1n, 0n)).toBe(64);
  });

  it('hashes a 9×8 thumbnail', () => {
    const flat = new Uint8Array(72).fill(100);
    expect(differenceHash(flat)).toBe(0n);
    const ramp = Uint8Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 10);
    expect(hammingDistance(differenceHash(ramp), 0n)).toBe(64);
    expect(() => differenceHash(new Uint8Array(10))).toThrow();
  });
});

describe('uploads', () => {
  it('detects the type from the bytes, not the name', () => {
    expect(detectEvidenceType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectEvidenceType(Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf');
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypisom'),
      Buffer.alloc(8),
    ]);
    expect(detectEvidenceType(mp4)).toBe('video/mp4');
    expect(detectEvidenceType(Buffer.from('MZ\x90\x00 executable'))).toBeNull();
    expect(detectEvidenceType(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(detectEvidenceType(Buffer.from('<html><script>'))).toBeNull();
  });

  it('requires the extension to match the bytes', () => {
    expect(extensionMatches('image/jpeg', 'after.JPG')).toBe(true);
    expect(extensionMatches('image/jpeg', 'after.exe')).toBe(false);
    expect(extensionMatches('application/pdf', 'report.pdf.exe')).toBe(false);
  });

  it('keeps file names safe to display and to put in a header', () => {
    expect(safeFileName('../../etc/passwd', 'jpg')).toBe('passwd');
    expect(safeFileName('C:\\Users\\me\\photo.jpg', 'jpg')).toBe('photo.jpg');
    expect(safeFileName('a<script>"x".jpg', 'jpg')).toBe('ascriptx.jpg');
    expect(safeFileName('\u0000\u0007', 'pdf')).toBe('evidence.pdf');
    expect(safeFileName(undefined, 'png')).toBe('evidence.png');
    expect(safeFileName('x'.repeat(300), 'jpg').length).toBe(120);
  });

  it('reads EXIF claims, then stores the image without them', async () => {
    const original = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#777' },
    })
      .withExif({
        IFD0: { Make: 'TestCam', Model: 'X1' },
        IFD2: { DateTimeOriginal: '2026:10:05 10:00:00' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '18/1 31/1 12/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: '73/1 51/1 0/1',
        },
      })
      .jpeg()
      .toBuffer();
    const claims = await readExif(original);
    expect(claims.device).toBe('TestCam X1');
    expect(claims.capturedAt).toBeInstanceOf(Date);
    expect(claims.gps!.latitude).toBeCloseTo(18.52, 2);
    expect(claims.gps!.longitude).toBeCloseTo(73.85, 2);

    const processed = await processImage(original, 'image/jpeg');
    expect(processed).toMatchObject({ width: 800, height: 600, device: 'TestCam X1' });
    const stripped = await readExif(processed.stored);
    expect(stripped).toEqual({ capturedAt: null, gps: null, device: null });
    expect((await sharp(processed.stored).metadata()).exif).toBeUndefined();
  });

  it('refuses something that only claims to be an image', async () => {
    await expect(
      processImage(Buffer.from([0xff, 0xd8, 0xff, 0, 1, 2]), 'image/jpeg'),
    ).rejects.toThrow();
  });
});

describe('AI response parsing', () => {
  const body = {
    relevance: { value: 0.9, confidence: 0.9 },
    visual_consistency: { value: null, confidence: 0 },
    completion_signals: { value: 0.8, confidence: 0.8 },
    documentation: { value: null, confidence: 0 },
    recommendation: 'LIKELY_RESOLVED',
    confidence: 0.85,
    supporting: [
      { text: 'Repair visible', refs: ['F1'] },
      { text: 'Invented', refs: ['F9'] },
    ],
    remaining_issues: [],
    ai_ran: true,
    documents_read: 0,
    provider: 'anthropic',
    model_name: 'm',
    model_version: '1',
    prompt_version: 'p',
  };
  const known = new Set(['F1', 'B1']);

  it('accepts valid output and drops uncited observations', () => {
    const parsed = parseVerificationResponse(body, known)!;
    expect(parsed.recommendation).toBe('LIKELY_RESOLVED');
    expect(parsed.supporting).toEqual([{ text: 'Repair visible', refs: ['F1'] }]);
    expect(parsed.visualConsistency).toEqual({ value: null, confidence: 0 });
  });

  it('rejects "RESOLVED", malformed values and dishonest provenance', () => {
    expect(
      parseVerificationResponse({ ...body, recommendation: 'RESOLVED' }, known),
    ).toBeNull();
    expect(
      parseVerificationResponse(
        { ...body, relevance: { value: 2, confidence: 1 } },
        known,
      ),
    ).toBeNull();
    expect(parseVerificationResponse({ ...body, ai_ran: false }, known)).toBeNull();
    expect(parseVerificationResponse({ ...body, confidence: 'high' }, known)).toBeNull();
    expect(parseVerificationResponse('garbage', known)).toBeNull();
  });

  it('accepts "no model ran" with no recommendation', () => {
    const none = parseVerificationResponse(
      { ...body, ai_ran: false, recommendation: null },
      known,
    )!;
    expect(none.recommendation).toBeNull();
  });
});

describe('notifications', () => {
  const decided = {
    type: 'VERIFICATION_DECIDED' as const,
    requestId: 'r1',
    projectId: 'p1',
    roomId: 'room1',
    problemPublicId: 'SAM-1042',
    organizationId: 'o1',
    governmentName: 'Pune MC',
    reason: 'Please add an inspection report showing water flow.',
    submitterIds: ['s1', 'actor'],
    actorUserId: 'actor',
  };

  it('tells the organisation, with the reason it must act on', () => {
    const drafts = planNotifications(
      { ...decided, decision: 'MORE_EVIDENCE_REQUESTED' },
      { organizationManagerIds: ['m1', 's1'] },
    );
    expect(drafts.map((d) => d.recipientId).sort()).toEqual(['m1', 's1']);
    expect(drafts[0]).toMatchObject({ type: 'RESOLUTION_MORE_EVIDENCE_REQUESTED' });
    expect(drafts[0]!.message).toContain('inspection report');
    expect(hrefFor('RESOLUTION_MORE_EVIDENCE_REQUESTED', drafts[0]!.metadata)).toBe(
      '/resolution/room1/project#evidence',
    );
  });

  it('sends officials to their verification page', () => {
    const drafts = planNotifications(
      {
        type: 'VERIFICATION_REQUESTED',
        requestId: 'r1',
        projectId: 'p1',
        roomId: 'room1',
        problemPublicId: 'SAM-1042',
        governmentOrganizationId: 'g1',
        governmentSlug: 'pune',
        organizationId: 'o1',
        organizationName: 'Clean City',
        actorUserId: 'm1',
      },
      { officialIds: ['g-user'], organizationManagerIds: ['m1', 'm2'] },
    );
    const official = drafts.find((d) => d.recipientId === 'g-user')!;
    expect(hrefFor(official.type, official.metadata)).toBe(
      '/government/pune/problems/SAM-1042#verification',
    );
    expect(drafts.map((d) => d.recipientId)).not.toContain('m1');
  });

  it('tells the citizen their problem was resolved', () => {
    const [reporter] = planNotifications({
      type: 'PROBLEM_STATUS_CHANGED',
      problemId: 'x',
      problemPublicId: 'SAM-1042',
      reporterId: 'citizen',
      fromStatus: 'IN_PROGRESS',
      toStatus: 'RESOLVED',
      actorUserId: 'official',
      changeId: 'c',
      reviewedBy: 'Pune MC',
    });
    expect(reporter).toMatchObject({
      recipientId: 'citizen',
      title: 'Your reported problem has been resolved',
      message: 'Your reported problem SAM-1042 has been resolved, verified by Pune MC.',
    });
  });
});
