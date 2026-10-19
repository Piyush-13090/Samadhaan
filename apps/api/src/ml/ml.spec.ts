import { describe, expect, it, vi } from 'vitest';
import type { AiService } from '../ai/ai.service.js';
import type { AppConfig } from '../config/app.config.js';
import type { PrismaService } from '../database/prisma.service.js';
import { lengthBucket, parsePrediction } from './ml-tasks.js';
import { ModelInferenceService } from './model-inference.service.js';
import {
  confidenceBin,
  driftCheck,
  populationStabilityIndex,
} from './model-monitoring.js';
import type {
  InferenceRecord,
  ModelMonitoringService,
} from './model-monitoring.service.js';
import { measuredCount } from './model-registry.service.js';

describe('prediction validation', () => {
  const ok = {
    label: 'POTHOLES',
    confidence: 0.82,
    abstained: false,
    abstain_reason: null,
    missing_features: [],
    latency_ms: 4,
  };

  it('accepts a well-formed prediction', () => {
    expect(parsePrediction('PROBLEM_CATEGORY', ok)).toMatchObject({
      label: 'POTHOLES',
      confidence: 0.82,
      abstained: false,
    });
  });

  it('rejects labels outside the task, bad confidence and inconsistent abstention', () => {
    expect(parsePrediction('PROBLEM_CATEGORY', { ...ok, label: 'CRITICAL' })).toBeNull();
    expect(parsePrediction('PROBLEM_SEVERITY', ok)).toBeNull();
    expect(parsePrediction('PROBLEM_CATEGORY', { ...ok, confidence: 1.4 })).toBeNull();
    expect(parsePrediction('PROBLEM_CATEGORY', { ...ok, abstained: true })).toBeNull();
    expect(parsePrediction('PROBLEM_CATEGORY', 'nonsense')).toBeNull();
  });

  it('accepts an abstention as a null label', () => {
    expect(
      parsePrediction('PROBLEM_CATEGORY', {
        ...ok,
        label: null,
        abstained: true,
        abstain_reason: 'low_confidence',
      }),
    ).toMatchObject({ label: null, abstained: true, abstainReason: 'low_confidence' });
  });

  it('buckets input length instead of storing text', () => {
    expect([10, 120, 300, 700, 5000].map(lengthBucket)).toEqual([
      '0-49',
      '50-199',
      '200-499',
      '500-999',
      '1000+',
    ]);
  });
});

describe('drift', () => {
  it('computes PSI: zero for identical distributions, large for a shift', () => {
    expect(populationStabilityIndex({ A: 50, B: 50 }, { A: 500, B: 500 })).toBe(0);
    // (0.9-0.5)ln(0.9/0.5) + (0.1-0.5)ln(0.1/0.5) = 0.2351 + 0.6438
    expect(populationStabilityIndex({ A: 50, B: 50 }, { A: 90, B: 10 })).toBeCloseTo(
      0.87889,
      5,
    );
  });

  it('refuses to judge drift on too few samples', () => {
    const check = driftCheck(
      'prediction',
      'x',
      { A: 5 },
      { B: 5 },
      { minSamples: 100, warn: 0.2 },
    );
    expect(check).toMatchObject({ status: 'not_assessable', psi: null });
    const shift = driftCheck(
      'prediction',
      'x',
      { A: 100, B: 100 },
      { A: 180, B: 20 },
      { minSamples: 100, warn: 0.2 },
    );
    expect(shift.status).toBe('shift');
  });

  it('bins confidence into tenths', () => {
    expect([0, 0.05, 0.55, 0.99, 1].map(confidenceBin)).toEqual([
      '0.0-0.1',
      '0.0-0.1',
      '0.5-0.6',
      '0.9-1.0',
      '0.9-1.0',
    ]);
  });
});

describe('registry rules', () => {
  it('counts held-out examples only when a measurement exists', () => {
    expect(measuredCount({ test: { n: 120 } })).toBe(120);
    expect(measuredCount({ n: 40, macroF1: 0.7 })).toBe(40);
    expect(measuredCount({ macroF1: 0.99 })).toBe(0);
    expect(measuredCount({ test: { n: 0 } })).toBe(0);
  });
});

describe('ModelInferenceService fallback', () => {
  const active = {
    id: 'mv-1',
    task: 'PROBLEM_CATEGORY',
    version: 'cat-v1',
    status: 'ACTIVE',
    syntheticData: false,
    artifactSha256: 'a'.repeat(64),
  };

  function build(opts: { enabled?: boolean; active?: unknown; call?: unknown }) {
    const recorded: InferenceRecord[] = [];
    const predictWithModel = vi.fn(async () => opts.call);
    const prisma = {
      activeModel: {
        findUnique: vi.fn(async () =>
          opts.active === undefined ? { modelVersion: active } : opts.active,
        ),
      },
    };
    const service = new ModelInferenceService(
      prisma as unknown as PrismaService,
      { predictWithModel } as unknown as AiService,
      {
        ml: {
          inferenceEnabled: opts.enabled ?? true,
          inferenceTimeoutMs: 1000,
          activeCacheSeconds: 0,
        },
      } as unknown as AppConfig,
      {
        record: vi.fn(async (r: InferenceRecord) => void recorded.push(r)),
      } as unknown as ModelMonitoringService,
    );
    return { service, predictWithModel, recorded };
  }
  const input = { title: 'Pothole', description: 'Deep pothole near the school gate' };

  it('does nothing when inference is disabled (the default)', async () => {
    const { service, predictWithModel, recorded } = build({ enabled: false });
    expect(await service.predict('PROBLEM_CATEGORY', input)).toBeNull();
    expect(predictWithModel).not.toHaveBeenCalled();
    expect(recorded).toEqual([]);
  });

  it('does nothing when no version is active', async () => {
    const { service, predictWithModel } = build({ active: null });
    expect(await service.predict('PROBLEM_CATEGORY', input)).toBeNull();
    expect(predictWithModel).not.toHaveBeenCalled();
  });

  it('never serves a pointer to a non-ACTIVE or synthetic version', async () => {
    const { service, predictWithModel } = build({
      active: { modelVersion: { ...active, syntheticData: true } },
    });
    expect(await service.predict('PROBLEM_CATEGORY', input)).toBeNull();
    expect(predictWithModel).not.toHaveBeenCalled();
  });

  it('returns an advisory prediction and records it without the input text', async () => {
    const { service, recorded } = build({
      call: {
        ok: true,
        body: {
          label: 'POTHOLES',
          confidence: 0.9,
          abstained: false,
          missing_features: [],
        },
      },
    });
    const result = await service.predict('PROBLEM_CATEGORY', input);
    expect(result).toMatchObject({
      label: 'POTHOLES',
      advisory: true,
      modelVersion: 'cat-v1',
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      outcome: 'OK',
      predictedLabel: 'POTHOLES',
      inputLength: '0-49',
    });
    expect(JSON.stringify(recorded[0])).not.toContain('school');
  });

  it.each([
    [{ ok: false, code: 'ARTIFACT_INTEGRITY', status: 409 }, 'ARTIFACT_ERROR'],
    [{ ok: false, code: 'INPUT_SCHEMA', status: 422 }, 'INPUT_SCHEMA'],
    [{ ok: false, code: 'TIMEOUT', status: null }, 'TIMEOUT'],
    [
      { ok: true, body: { label: 'NOT_A_CATEGORY', confidence: 0.9, abstained: false } },
      'ERROR',
    ],
  ])('falls back (null) and records %o as %s', async (call, outcome) => {
    const { service, recorded } = build({ call });
    expect(await service.predict('PROBLEM_CATEGORY', input)).toBeNull();
    expect(recorded[0]?.outcome).toBe(outcome);
  });
});
