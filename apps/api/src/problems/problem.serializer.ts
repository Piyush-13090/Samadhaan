import type { ProblemImageView, ProblemView } from '@samadhaan/shared';
import type { Problem, ProblemImage, User } from '../generated/prisma/client.js';

/**
 * The only problem shape the API emits.
 *
 * An explicit allow-list, as everywhere else. It matters especially here
 * because `Problem` will accumulate AI columns, priority scores and internal
 * counters over the next milestones — a spread would publish each one by
 * default the moment it is added.
 */

export type ProblemWithRelations = Problem & {
  images: ProblemImage[];
  reporter: User;
};

/** Resolves storage keys to URLs. Async because signed URLs involve work. */
export type ImageUrlResolver = (storageKey: string) => Promise<string>;

async function toImageView(
  image: ProblemImage,
  resolveUrl: ImageUrlResolver,
): Promise<ProblemImageView> {
  return {
    id: image.id,
    // Resolved on read rather than read from the stored `url` column: a signed
    // URL expires, and a CDN hostname can change. The key is the durable fact.
    url: await resolveUrl(image.storageKey),
    width: image.width,
    height: image.height,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary,
  };
}

/**
 * The reporter at the privacy level a public problem page may show.
 *
 * Name and avatar only. A civic report is public, but the person who filed it
 * did not thereby consent to publishing their email, phone or account state —
 * and the display name is preferred where set, because that is the identity
 * they chose to be known by.
 */
function toReporterView(reporter: User) {
  return {
    id: reporter.id,
    name: reporter.displayName ?? reporter.fullName,
    avatarUrl: reporter.avatarUrl,
  };
}

export async function toProblemView(
  problem: ProblemWithRelations,
  resolveUrl: ImageUrlResolver,
  options: { viewerId?: string } = {},
): Promise<ProblemView> {
  const images = await Promise.all(
    problem.images
      .filter((image) => image.deletedAt === null)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((image) => toImageView(image, resolveUrl)),
  );

  return {
    id: problem.id,
    publicId: problem.publicId,
    title: problem.title,
    description: problem.description,
    category: problem.category,
    subcategory: problem.subcategory,
    status: problem.status,
    severity: problem.severity,
    location: {
      // Prisma returns Decimal; the wire format is a number.
      latitude: Number(problem.latitude),
      longitude: Number(problem.longitude),
      address: problem.address,
      city: problem.city,
      state: problem.state,
      country: problem.country,
      postalCode: problem.postalCode,
    },
    images,
    reporter: toReporterView(problem.reporter),
    voteCount: problem.voteCount,
    commentCount: problem.commentCount,
    createdAt: problem.createdAt.toISOString(),
    submittedAt: problem.submittedAt?.toISOString() ?? null,
    ...(options.viewerId ? { isOwnReport: problem.reporterId === options.viewerId } : {}),
  };
}
