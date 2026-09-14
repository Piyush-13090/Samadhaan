import { redirect } from 'next/navigation';

/**
 * Retired route.
 *
 * `Nearby` and `Explore` had become the same page — both answered "what has
 * been reported around me", from the same query. Explore kept the distance
 * filter, so this redirects rather than 404s: bookmarks and any link already
 * in the wild still land somewhere correct.
 */
export default function NearbyPage() {
  redirect('/explore');
}
