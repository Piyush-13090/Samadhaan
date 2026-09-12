import { ApiClient } from './api-client';
import { env, getServerApiUrl } from './env';

/**
 * Client for use in the browser. Reads the public API URL.
 */
export const api = new ApiClient(env.apiUrl);

/**
 * Client for server components and route handlers, which may reach the API on
 * a different hostname (a Docker service name rather than localhost).
 *
 * Server-only: do not import into a client component.
 */
export function createServerApi(): ApiClient {
  return new ApiClient(getServerApiUrl());
}
