import { cookies } from 'next/headers';

/**
 * The incoming request's cookies as a `Cookie` header, for server components
 * that call the API on the user's behalf. Server-only.
 */
export async function requestCookieHeader(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}
