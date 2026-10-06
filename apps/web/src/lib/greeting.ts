/**
 * Time-aware greeting.
 *
 * Resolved on the server from the server's clock, which is close enough: every
 * user of this deployment is in one timezone, and a greeting is not worth
 * shipping a client-side hydration boundary for.
 */
export function greeting(hour = new Date().getHours()): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
