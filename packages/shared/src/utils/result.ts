/**
 * Lightweight result type for operations that are expected to fail
 * (dependency probes, upstream calls) and should not throw.
 */
export type Result<TValue, TError = Error> =
  { ok: true; value: TValue } | { ok: false; error: TError };

export function ok<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

export function err<TError>(error: TError): Result<never, TError> {
  return { ok: false, error };
}

/** Normalises an unknown thrown value into a readable message. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}
