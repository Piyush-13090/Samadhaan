import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { toVectorLiteral } from '../problems/services/problem-embedding.store.js';
import {
  buildOrganizationProfileText,
  profileSourceHash,
} from './organization-profile-text.js';

export type EmbeddingRefresh = 'unchanged' | 'updated' | 'failed' | 'missing';

/**
 * Keeps each organisation's profile embedding current.
 *
 * Content-addressed: the SHA-256 of the exact text that would be encoded is
 * compared with the stored `sourceHash`, and the encoder is only called when
 * they differ. Editing a phone number re-embeds nothing; editing the
 * description or expertise always re-embeds.
 */
@Injectable()
export class OrganizationEmbeddingService {
  private readonly logger = new Logger(OrganizationEmbeddingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async refresh(organizationId: string): Promise<EmbeddingRefresh> {
    const organization = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: {
        name: true,
        type: true,
        description: true,
        expertise: {
          select: { category: true, subcategory: true },
          orderBy: { category: 'asc' },
        },
      },
    });
    if (!organization) return 'missing';

    const text = buildOrganizationProfileText(organization);
    const hash = profileSourceHash(text);

    const current = await this.prisma.organizationEmbedding.findFirst({
      where: { organizationId, sourceHash: hash },
      select: { id: true },
    });
    if (current) return 'unchanged';

    const outcome = await this.ai.embedText([text]);
    const vector = outcome.ok ? outcome.embeddings.vectors[0] : undefined;
    if (!outcome.ok || !vector) {
      // The organisation still takes part in matching through its expertise
      // categories; only the semantic signal is missing until the next try.
      this.logger.warn(
        `Embedding failed for organisation ${organizationId}: ${
          outcome.ok ? 'no vector' : outcome.failure.code
        }`,
      );
      return 'failed';
    }

    const { modelName, modelVersion, dimensions } = outcome.embeddings;
    await this.prisma.$executeRaw`
      INSERT INTO organization_embeddings
        ("id", "organizationId", "modelName", "modelVersion", "dimensions",
         "sourceHash", "embedding", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), ${organizationId}::uuid, ${modelName}, ${modelVersion},
         ${dimensions}, ${hash}, ${toVectorLiteral(vector)}::vector, now(), now())
      ON CONFLICT ("organizationId", "modelName")
      DO UPDATE SET
        "embedding" = EXCLUDED."embedding",
        "modelVersion" = EXCLUDED."modelVersion",
        "dimensions" = EXCLUDED."dimensions",
        "sourceHash" = EXCLUDED."sourceHash",
        "updatedAt" = now()
    `;

    this.logger.log(`Organisation ${organizationId} embedded (${modelName})`);
    return 'updated';
  }

  /**
   * Embeds eligible organisations that have no embedding at all — new ones,
   * or ones whose earlier attempt failed. Bounded and sequential.
   */
  async backfill(limit: number): Promise<number> {
    const missing = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT o.id FROM organizations o
      WHERE o."deletedAt" IS NULL
        AND o.type IN ('NGO', 'UNIVERSITY', 'INDUSTRY')
        AND NOT EXISTS (
          SELECT 1 FROM organization_embeddings e WHERE e."organizationId" = o.id
        )
      ORDER BY o."createdAt" ASC
      LIMIT ${limit}
    `;

    let embedded = 0;
    for (const { id } of missing) {
      if ((await this.refresh(id)) === 'updated') embedded += 1;
    }
    return embedded;
  }
}
