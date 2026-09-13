/**
 * Organisation slug generation.
 *
 * **Slugs are stable.** Once assigned, a slug never changes — not when the
 * organisation is renamed, not when it is re-verified. A public profile URL
 * that appears in a government record, a press mention or a citizen's bookmark
 * must keep resolving; silently repointing it breaks every one of those.
 *
 * The cost is that a renamed organisation keeps its old slug. That is the right
 * trade for a civic platform, and the alternative — rotating slugs with a
 * redirect table — is complexity this milestone does not need. If vanity URLs
 * are ever wanted, the extension is an `organization_slug_aliases` table, which
 * preserves the old URLs rather than discarding them.
 */

const MAX_SLUG_LENGTH = 80;

/**
 * Normalises a name into a URL-safe slug.
 *
 * Unicode is decomposed and combining marks stripped, so "Pūrṇa Foundation"
 * becomes `purna-foundation` rather than being mangled or rejected. Names with
 * no Latin characters at all produce an empty stem, which the caller replaces
 * with a stable fallback.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

/**
 * Produces a slug that is not already taken.
 *
 * `isTaken` is injected rather than the database being queried here, so this
 * stays a pure function that can be tested without a database.
 *
 * **This is not a substitute for the unique constraint.** Two concurrent
 * creations can both see a candidate as free and both try to claim it; the
 * database rejects the loser, and the caller retries. Checking first only keeps
 * the common case from producing an ugly suffix.
 */
export async function generateUniqueSlug(
  name: string,
  isTaken: (slug: string) => Promise<boolean>,
  options: { maxAttempts?: number } = {},
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? 50;
  const stem = slugify(name) || 'organization';

  if (!(await isTaken(stem))) return stem;

  // Numeric suffixes first: `clean-city-2` reads better than a random tail and
  // is what a person would expect to see.
  for (let suffix = 2; suffix <= maxAttempts; suffix += 1) {
    const candidate = `${stem.slice(0, MAX_SLUG_LENGTH - 4)}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  // Fallback for a pathological number of collisions on one name. Random rather
  // than sequential so it terminates in one step instead of scanning further.
  const random = Math.random().toString(36).slice(2, 8);
  return `${stem.slice(0, MAX_SLUG_LENGTH - 7)}-${random}`;
}
