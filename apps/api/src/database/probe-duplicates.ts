/**
 * Development probe: runs a real duplicate check against the seeded data.
 *
 * Not part of the test suite — it needs the AI service running and talks to the
 * development database. Kept because it is the fastest way to see the whole
 * pipeline work end to end. Run with: npm run probe:duplicates
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { PrismaService } from './prisma.service.js';
import { DuplicateDetectionService } from '../problems/services/duplicate-detection.service.js';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });

const prisma = app.get(PrismaService);
const duplicates = app.get(DuplicateDetectionService);

const problems = await prisma.problem.findMany({
  where: { deletedAt: null },
  orderBy: { createdAt: 'asc' },
  select: { id: true, publicId: true, title: true },
});

console.log(`Embedding and checking ${problems.length} problems...\n`);

for (const problem of problems) {
  await duplicates.enqueue(problem.id);
}

// The checks are detached; give them time to finish.
await new Promise((resolve) => setTimeout(resolve, 25_000));

for (const problem of problems) {
  const check = await duplicates.findCheck(problem.id, (key) => key);
  if (check.candidates.length === 0) continue;

  console.log(`${problem.publicId}  ${problem.title}`);
  for (const candidate of check.candidates) {
    console.log(
      `   -> ${candidate.problem.publicId}  ${(candidate.similarity * 100).toFixed(0)}%  ` +
        `conf ${(candidate.confidence * 100).toFixed(0)}%  ` +
        `${candidate.distanceMeters}m  ${candidate.verdict}`,
    );
    console.log(
      `      text ${candidate.signals.text} geo ${candidate.signals.geographic} ` +
        `cat ${candidate.signals.category} time ${candidate.signals.temporal}`,
    );
    console.log(`      ${candidate.evidence.map((e) => e.label).join(' | ')}`);
  }
  console.log();
}

await app.close();
process.exit(0);
