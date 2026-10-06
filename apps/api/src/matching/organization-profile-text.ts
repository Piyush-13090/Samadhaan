import { createHash } from 'node:crypto';

/**
 * The text that represents an organisation in the embedding space.
 *
 * Name, type, description and declared areas of work — what the organisation
 * *does*. Deliberately absent: contact details, people, and location. Location
 * is measured by PostGIS as its own (weak) signal; putting the city in the
 * text as well would count geography twice.
 *
 * Mirrored by `organization_profile_text` in
 * services/ai/evaluation/organization_matching.py, so the development
 * evaluation set encodes organisations exactly as production does. Change both.
 */
export function buildOrganizationProfileText(organization: {
  name: string;
  type: string;
  description: string | null;
  expertise: Array<{ category: string; subcategory: string | null }>;
}): string {
  const areas = organization.expertise
    .map((entry) =>
      entry.subcategory
        ? `${words(entry.category)}: ${entry.subcategory}`
        : words(entry.category),
    )
    .join('; ');

  return [
    organization.name,
    `Organisation type: ${organization.type.toLowerCase()}`,
    organization.description ?? '',
    areas ? `Areas of work: ${areas}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** SHA-256 of the profile text. Equal hashes mean an identical embedding input. */
export function profileSourceHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function words(category: string): string {
  return category.replaceAll('_', ' ').toLowerCase();
}
