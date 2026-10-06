import { EMBEDDING_DIMENSIONS } from '@samadhaan/shared';
import type { PrismaService } from '../../database/prisma.service.js';

/**
 * Reads and writes problem text embeddings.
 *
 * Shared by duplicate detection, which creates them, and organisation
 * matching, which reuses them — one embedding per problem per model, never a
 * second copy computed for a second feature.
 */

/**
 * Writes the problem's text embedding.
 *
 * Raw SQL because Prisma cannot express `vector`. The cast is explicit and
 * the vector is parameterised as a string — never interpolated — so the
 * usual raw-SQL hazard does not apply.
 *
 * Upsert on `(problemId, embeddingType, modelName)`: re-embedding with the
 * *same* model replaces the row, while a different model writes a new one.
 * That is what keeps a model change from silently overwriting the corpus it
 * can no longer be compared with.
 */
export async function storeProblemEmbedding(
  prisma: PrismaService,
  problemId: string,
  vector: number[],
  meta: { modelName: string; modelVersion: string; dimensions: number },
): Promise<void> {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Refusing to store a ${vector.length}-dimensional vector; ` +
        `the column is ${EMBEDDING_DIMENSIONS}.`,
    );
  }

  const literal = toVectorLiteral(vector);

  // Columns are camelCase and therefore case-sensitive in PostgreSQL: Prisma
  // maps table names via `@@map` but leaves field names as written, so every
  // identifier here must stay quoted.
  await prisma.$executeRaw`
    INSERT INTO problem_embeddings
      ("id", "problemId", "embeddingType", "modelName", "modelVersion",
       "dimensions", "embedding", "createdAt")
    VALUES
      (gen_random_uuid(), ${problemId}::uuid, 'TEXT'::"EmbeddingType",
       ${meta.modelName}, ${meta.modelVersion}, ${meta.dimensions},
       ${literal}::vector, now())
    ON CONFLICT ("problemId", "embeddingType", "modelName")
    DO UPDATE SET
      "embedding" = EXCLUDED."embedding",
      "modelVersion" = EXCLUDED."modelVersion",
      "dimensions" = EXCLUDED."dimensions",
      "createdAt" = now()
  `;
}

/** The problem's most recent text embedding, or `null`. */
export async function findProblemEmbedding(
  prisma: PrismaService,
  problemId: string,
): Promise<{ vector: number[]; modelName: string } | null> {
  const rows = await prisma.$queryRaw<Array<{ embedding: string; modelName: string }>>`
    SELECT "embedding"::text AS "embedding", "modelName" AS "modelName"
    FROM problem_embeddings
    WHERE "problemId" = ${problemId}::uuid
      AND "embeddingType" = 'TEXT'
      AND "embedding" IS NOT NULL
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { vector: parseVectorLiteral(row.embedding), modelName: row.modelName };
}

/** `[0.1,0.2,…]` — pgvector's text form, bound as a parameter and cast. */
export function toVectorLiteral(vector: number[]): string {
  if (!vector.every((value) => Number.isFinite(value))) {
    throw new Error('Refusing to write a vector containing a non-finite value.');
  }
  return `[${vector.join(',')}]`;
}

export function parseVectorLiteral(literal: string): number[] {
  return literal
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((value) => Number(value));
}
