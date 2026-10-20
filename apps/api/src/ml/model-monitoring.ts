/**
 * Pure monitoring calculations (Prompt 28), unit-tested in ml.spec.ts.
 */

/**
 * Population stability index between two categorical distributions (counts).
 * Each side is smoothed with a small epsilon, so a category present on one side
 * only contributes a large but finite term. 0 = identical; > 0.2 is the
 * conventional "significant shift" level, which ML_DRIFT_PSI_WARN defaults to.
 */
export function populationStabilityIndex(
  expected: Record<string, number>,
  actual: Record<string, number>,
  epsilon = 1e-4,
): number {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
  const e = Object.values(expected).reduce((a, b) => a + b, 0);
  const a = Object.values(actual).reduce((x, y) => x + y, 0);
  if (e === 0 || a === 0) return 0;
  let psi = 0;
  for (const key of keys) {
    const p = Math.max((expected[key] ?? 0) / e, epsilon);
    const q = Math.max((actual[key] ?? 0) / a, epsilon);
    psi += (q - p) * Math.log(q / p);
  }
  return Number(psi.toFixed(6));
}

export type DriftKind = 'prediction' | 'data' | 'reference';

export interface DriftCheck {
  kind: DriftKind;
  /** What is compared, in words. */
  compares: string;
  psi: number | null;
  status: 'ok' | 'shift' | 'not_assessable';
  note: string | null;
}

/**
 * One drift comparison. Too few samples on either side makes it "not
 * assessable" rather than a number that looks meaningful.
 */
export function driftCheck(
  kind: DriftKind,
  compares: string,
  expected: Record<string, number>,
  actual: Record<string, number>,
  options: { minSamples: number; warn: number },
): DriftCheck {
  const ne = Object.values(expected).reduce((a, b) => a + b, 0);
  const na = Object.values(actual).reduce((a, b) => a + b, 0);
  if (ne < options.minSamples || na < options.minSamples) {
    return {
      kind,
      compares,
      psi: null,
      status: 'not_assessable',
      note: `needs ${options.minSamples} samples on each side (have ${ne} and ${na})`,
    };
  }
  const psi = populationStabilityIndex(expected, actual);
  return { kind, compares, psi, status: psi > options.warn ? 'shift' : 'ok', note: null };
}

export function confidenceBin(confidence: number): string {
  const bin = Math.min(9, Math.max(0, Math.floor(confidence * 10)));
  return `${(bin / 10).toFixed(1)}-${((bin + 1) / 10).toFixed(1)}`;
}
