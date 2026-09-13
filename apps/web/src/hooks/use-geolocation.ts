'use client';

import { useCallback, useState } from 'react';

/**
 * Browser geolocation, with the failure modes handled explicitly.
 *
 * Geolocation fails in several distinct ways that need different wording: the
 * user declined, the device could not get a fix, the request timed out, or the
 * API is unavailable entirely (an insecure origin, or an older browser).
 * Collapsing them into "location unavailable" leaves the user with no idea
 * whether to retry, change a setting, or type the address instead.
 *
 * Never throws and never blocks. A denied permission is an expected outcome —
 * the form's manual entry remains fully usable.
 */

export interface GeolocationResult {
  latitude: number;
  longitude: number;
  /** Device-reported accuracy in metres. */
  accuracyMeters: number | null;
}

export type GeolocationStatus = 'idle' | 'locating' | 'success' | 'error';

export interface UseGeolocation {
  status: GeolocationStatus;
  position: GeolocationResult | null;
  /** Human-readable and actionable; safe to show directly. */
  error: string | null;
  request: () => Promise<GeolocationResult | null>;
  reset: () => void;
}

function describe(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Location access was blocked. Allow it in your browser settings, or enter the address below.';
    case error.POSITION_UNAVAILABLE:
      return 'Your device could not determine a location. Please enter the address below.';
    case error.TIMEOUT:
      return 'Finding your location took too long. Try again, or enter the address below.';
    default:
      return 'Could not get your location. Please enter the address below.';
  }
}

export function useGeolocation(): UseGeolocation {
  const [status, setStatus] = useState<GeolocationStatus>('idle');
  const [position, setPosition] = useState<GeolocationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (): Promise<GeolocationResult | null> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('error');
      setError(
        'This browser cannot detect your location. Please enter the address below.',
      );
      return null;
    }

    setStatus('locating');
    setError(null);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (result) => {
          const next: GeolocationResult = {
            latitude: Number(result.coords.latitude.toFixed(6)),
            longitude: Number(result.coords.longitude.toFixed(6)),
            accuracyMeters: result.coords.accuracy
              ? Math.round(result.coords.accuracy)
              : null,
          };

          setPosition(next);
          setStatus('success');
          resolve(next);
        },
        (failure) => {
          setStatus('error');
          setError(describe(failure));
          resolve(null);
        },
        {
          // Worth the battery: a civic problem needs the right street, not the
          // right neighbourhood.
          enableHighAccuracy: true,
          timeout: 15_000,
          // A minute-old fix is fine and avoids a second hardware wake-up.
          maximumAge: 60_000,
        },
      );
    });
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setPosition(null);
    setError(null);
  }, []);

  return { status, position, error, request, reset };
}
