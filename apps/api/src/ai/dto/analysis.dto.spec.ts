import { describe, expect, it } from 'vitest';
import { parseAnalysisFailure, parseAnalysisResponse } from './analysis.dto.js';

/**
 * The second of two independent validations. The AI service validates its own
 * output, but this process performs the database write — trusting a remote
 * service's promise about its own shape is how an unknown enum reaches a column.
 */
const VALID = {
  problem_id: 'prb-1',
  provider: 'anthropic',
  model_name: 'claude-opus-5',
  model_version: 'claude-opus-5',
  category: 'POTHOLES',
  subcategory: 'road surface cavity',
  severity: 'HIGH',
  urgency: 'HIGH',
  summary: 'A large pothole on a busy road is causing vehicles to swerve.',
  confidence: 0.94,
  observations: ['Visible road damage.', 'Description mentions accidents.'],
  severity_score: 7.5,
  processing_ms: 2400,
  image_count: 1,
  text_only: false,
};

describe('parseAnalysisResponse', () => {
  it('accepts and converts a valid response', () => {
    const result = parseAnalysisResponse(VALID);

    expect(result).toMatchObject({
      category: 'POTHOLES',
      severity: 'HIGH',
      urgency: 'HIGH',
      confidence: 0.94,
      severityScore: 7.5,
      modelName: 'claude-opus-5',
      textOnly: false,
    });
  });

  // Taxonomy enforcement: an unknown value must never reach the column.
  it('rejects a category outside the taxonomy', () => {
    expect(parseAnalysisResponse({ ...VALID, category: 'SPACE_JUNK' })).toBeNull();
    expect(parseAnalysisResponse({ ...VALID, category: 'roads' })).toBeNull();
  });

  it('rejects an unknown severity or urgency', () => {
    expect(parseAnalysisResponse({ ...VALID, severity: 'CATASTROPHIC' })).toBeNull();
    expect(parseAnalysisResponse({ ...VALID, urgency: 'WHENEVER' })).toBeNull();
  });

  it('rejects a confidence outside 0–1', () => {
    expect(parseAnalysisResponse({ ...VALID, confidence: 1.5 })).toBeNull();
    expect(parseAnalysisResponse({ ...VALID, confidence: -0.1 })).toBeNull();
    expect(parseAnalysisResponse({ ...VALID, confidence: 94 })).toBeNull();
  });

  it('rejects a non-numeric confidence', () => {
    expect(parseAnalysisResponse({ ...VALID, confidence: 'high' })).toBeNull();
    expect(parseAnalysisResponse({ ...VALID, confidence: Number.NaN })).toBeNull();
  });

  it('rejects a missing summary or model name', () => {
    expect(parseAnalysisResponse({ ...VALID, summary: '' })).toBeNull();
    expect(parseAnalysisResponse({ ...VALID, model_name: '   ' })).toBeNull();
  });

  it('rejects anything that is not an object', () => {
    expect(parseAnalysisResponse(null)).toBeNull();
    expect(parseAnalysisResponse('completed')).toBeNull();
    expect(parseAnalysisResponse([])).toBeNull();
  });

  it('clamps a severity score into range', () => {
    expect(parseAnalysisResponse({ ...VALID, severity_score: 99 })?.severityScore).toBe(10);
    expect(parseAnalysisResponse({ ...VALID, severity_score: -5 })?.severityScore).toBe(0);
  });

  // A misbehaving provider must not be able to store an unbounded string.
  it('bounds the summary and observations', () => {
    const result = parseAnalysisResponse({
      ...VALID,
      summary: 'x'.repeat(5000),
      observations: Array.from({ length: 20 }, () => 'y'.repeat(600)),
    });

    expect(result?.summary.length).toBe(1000);
    expect(result?.observations).toHaveLength(5);
    expect(result?.observations[0]?.length).toBe(300);
  });

  it('drops non-string observations rather than failing', () => {
    const result = parseAnalysisResponse({
      ...VALID,
      observations: ['Valid.', 42, null, '  ', 'Also valid.'],
    });

    expect(result?.observations).toEqual(['Valid.', 'Also valid.']);
  });

  it('treats a missing subcategory as absent', () => {
    expect(parseAnalysisResponse({ ...VALID, subcategory: null })?.subcategory).toBeNull();
  });
});

describe('parseAnalysisFailure', () => {
  it('reads a structured failure', () => {
    expect(
      parseAnalysisFailure({ code: 'TIMEOUT', message: 'Too slow', retryable: true }),
    ).toEqual({ code: 'TIMEOUT', message: 'Too slow', retryable: true });
  });

  /**
   * The conservative default. Assuming retryable on a malformed error body
   * would let a permanent failure burn paid API calls in a loop.
   */
  it('defaults retryable to false when absent', () => {
    expect(
      parseAnalysisFailure({ code: 'PROVIDER_ERROR', message: 'Bad' })?.retryable,
    ).toBe(false);
  });

  it('rejects a body that is not a structured failure', () => {
    expect(parseAnalysisFailure({ detail: 'oops' })).toBeNull();
    expect(parseAnalysisFailure(null)).toBeNull();
  });
});
