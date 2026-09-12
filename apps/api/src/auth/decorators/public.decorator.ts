import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'samadhaan:isPublic';

/**
 * Marks a route as reachable without authentication.
 *
 * Authentication is applied globally, so the default for every new endpoint is
 * "protected". Exposing something publicly then requires a deliberate,
 * greppable act — the opposite of a system where forgetting a decorator
 * silently leaves a route open.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
