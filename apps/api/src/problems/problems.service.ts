import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, type ProblemView, type UploadedImage } from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { buildProblemImageKey, isSafeStorageKey } from '../storage/storage-key.js';
import { StorageService } from '../storage/storage.types.js';
import type { CreateProblemDto } from './dto/create-problem.dto.js';
import { toProblemView } from './problem.serializer.js';
import { ImageValidationService } from './services/image-validation.service.js';
import { PendingUploadService } from './services/pending-upload.service.js';
import { DuplicateDetectionService } from './services/duplicate-detection.service.js';
import { ProblemAnalysisService } from './services/problem-analysis.service.js';

@Injectable()
export class ProblemsService {
  private readonly logger = new Logger(ProblemsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly images: ImageValidationService,
    private readonly pending: PendingUploadService,
    private readonly analysis: ProblemAnalysisService,
    private readonly duplicates: DuplicateDetectionService,
    private readonly config: AppConfig,
  ) {}

  /** Resolves a storage key to a fetchable URL. Passed into the serializer. */
  private readonly resolveUrl = (key: string) => this.storage.getUrl(key);

  /**
   * The same resolver, for callers outside this service.
   *
   * The duplicate serializer needs thumbnails but has no business holding a
   * `StorageService` — resolving a key stays this module's job.
   */
  resolveImageUrl(key: string): Promise<string> {
    return this.storage.getUrl(key);
  }

  /**
   * Accepts one uploaded image.
   *
   * The file is validated by decoding it — the filename, extension and
   * declared MIME type are all attacker-controlled and are used only as
   * metadata. The storage key is generated from the *detected* type, so a
   * `.php` named `photo.jpg` cannot end up written with an executable
   * extension.
   */
  async uploadImage(
    file: { buffer: Buffer; originalname?: string; mimetype?: string },
    user: RequestUser,
  ): Promise<UploadedImage> {
    const validated = await this.images.validate(file.buffer, file.originalname);

    const storageKey = buildProblemImageKey(validated.contentType);

    await this.storage.put({
      key: storageKey,
      body: file.buffer,
      contentType: validated.contentType,
      cacheSeconds: 31_536_000,
    });

    // The original name is kept for display only. It is never a path.
    const originalFileName = file.originalname?.slice(0, 255) ?? null;

    await this.pending.record({
      storageKey,
      contentType: validated.contentType,
      originalFileName,
      sizeBytes: validated.sizeBytes,
      width: validated.width,
      height: validated.height,
      userId: user.id,
      uploadedAt: new Date().toISOString(),
    });

    return {
      storageKey,
      url: await this.storage.getUrl(storageKey),
      contentType: validated.contentType,
      originalFileName,
      sizeBytes: validated.sizeBytes,
      width: validated.width,
      height: validated.height,
    };
  }

  /**
   * Creates a problem from a citizen's report.
   *
   * The problem and its images are written in **one transaction**: a report
   * that exists without the photo proving it is worse than no report, because
   * nothing downstream can tell the difference between "no photo was taken" and
   * "the photo was lost".
   *
   * Status is `SUBMITTED`, never `VERIFIED`. Severity and urgency keep their
   * schema defaults — the AI assesses them in the next milestone and a reviewer
   * confirms. `publicId` comes from the PostgreSQL sequence, so concurrent
   * reports cannot collide.
   */
  async create(dto: CreateProblemDto, user: RequestUser): Promise<ProblemView> {
    const imageInputs = dto.images ?? [];

    const claimedKeys = await this.resolveClaimedImages(imageInputs, user);

    try {
      const problem = await this.prisma.$transaction(async (tx) => {
        const created = await tx.problem.create({
          data: {
            // From the verified token. Never from the request body — that is
            // what stops a report being filed in someone else's name.
            reporterId: user.id,
            title: dto.title,
            description: dto.description,
            category: dto.category,
            subcategory: dto.subcategory ?? null,
            // Explicit rather than relying on the schema default, so the
            // intended initial state is visible at the call site.
            status: 'SUBMITTED',
            submittedAt: new Date(),
            address: dto.location.address ?? null,
            city: dto.location.city ?? null,
            state: dto.location.state ?? null,
            country: dto.location.country ?? 'India',
            postalCode: dto.location.postalCode ?? null,
            latitude: dto.location.latitude,
            longitude: dto.location.longitude,
            locationAccuracyM: dto.location.accuracyMeters ?? null,
            // `location` (PostGIS) is populated by the database trigger from
            // these coordinates — see docs/DATABASE.md §5.
          },
        });

        if (claimedKeys.length > 0) {
          await tx.problemImage.createMany({
            data: claimedKeys.map((image) => ({
              problemId: created.id,
              storageKey: image.storageKey,
              originalFileName: image.originalFileName,
              mimeType: image.contentType,
              fileSize: image.sizeBytes,
              width: image.width,
              height: image.height,
              kind: 'BEFORE',
              sortOrder: image.sortOrder,
              isPrimary: image.isPrimary,
            })),
          });
        }

        return tx.problem.findUniqueOrThrow({
          where: { id: created.id },
          include: { images: true, reporter: true },
        });
      });

      // Only after the transaction commits: releasing the claim earlier would
      // let a retry of a failed submission find the keys already consumed.
      await this.pending.claim(claimedKeys.map((image) => image.storageKey));

      this.logger.log(`Problem ${problem.publicId} reported by ${user.id}`);

      // Queued *after* the transaction commits, so the report is durable before
      // anything depends on it. Both are enhancements: if neither runs, the
      // civic record is still complete and the citizen still has their
      // reference number.
      //
      // Independent of each other on purpose. Duplicate detection works from
      // the citizen's own words, not from the AI's reading of them, so a failed
      // analysis must not also cost the deduplication — and chaining them would
      // put a vision-model call on the critical path of a vector search.
      await this.analysis.enqueue(problem.id);
      await this.duplicates.enqueue(problem.id);

      return toProblemView(problem, this.resolveUrl, { viewerId: user.id });
    } catch (error) {
      // The transaction rolled back, so the rows are gone but the files are
      // not. Remove them rather than leaking storage on every failed submit.
      await this.pending.discard(claimedKeys.map((image) => image.storageKey));
      throw error;
    }
  }

  /**
   * Validates the attached images and returns their metadata.
   *
   * Three things are checked, and all three matter:
   *
   *  1. **Key shape** — a key that could not have come from this application
   *     never reaches the filesystem driver.
   *  2. **Ownership** — the pending-upload record says who uploaded it. Without
   *     this, anyone could attach a key belonging to someone else's upload.
   *  3. **Exactly one primary** — normalised rather than rejected, so a client
   *     bug does not cost the citizen their report.
   */
  private async resolveClaimedImages(
    inputs: Array<{ storageKey: string; sortOrder: number; isPrimary: boolean }>,
    user: RequestUser,
  ) {
    if (inputs.length === 0) return [];

    if (inputs.length > this.config.maxImagesPerProblem) {
      throw this.validationError(
        `Attach at most ${this.config.maxImagesPerProblem} photos.`,
        'images',
      );
    }

    const unsafe = inputs.filter((input) => !isSafeStorageKey(input.storageKey));
    if (unsafe.length > 0) {
      throw this.validationError('One of the attached photos is invalid.', 'images');
    }

    const seen = new Set<string>();
    for (const input of inputs) {
      if (seen.has(input.storageKey)) {
        throw this.validationError('The same photo was attached twice.', 'images');
      }
      seen.add(input.storageKey);
    }

    const resolved = await Promise.all(
      inputs.map(async (input) => {
        const record = await this.pending.find(input.storageKey);

        // One message for "never existed", "expired" and "someone else's".
        // Distinguishing them would tell an attacker which keys are real.
        if (!record || record.userId !== user.id) {
          throw this.validationError(
            'One of your photos could not be attached. Please upload it again.',
            'images',
          );
        }

        return { ...record, sortOrder: input.sortOrder, isPrimary: input.isPrimary };
      }),
    );

    // Normalise: exactly one primary, defaulting to the first image.
    const primaryCount = resolved.filter((image) => image.isPrimary).length;
    if (primaryCount !== 1) {
      return resolved.map((image, index) => ({ ...image, isPrimary: index === 0 }));
    }

    return resolved;
  }

  /**
   * A problem by its public identifier.
   *
   * Public: civic reports are a public record. Soft-deleted problems return the
   * same 404 as a missing one.
   */
  async findByPublicId(
    publicId: string,
    viewer: RequestUser | null,
  ): Promise<ProblemView> {
    const problem = await this.prisma.problem.findFirst({
      where: { publicId: publicId.toUpperCase(), deletedAt: null },
      include: { images: true, reporter: true },
    });

    if (!problem) throw AppException.notFound('Problem');

    // A draft is not yet public — only its reporter may see it.
    if (problem.status === 'DRAFT' && problem.reporterId !== viewer?.id) {
      throw AppException.notFound('Problem');
    }

    return toProblemView(problem, this.resolveUrl, { viewerId: viewer?.id });
  }

  private validationError(message: string, field: string): AppException {
    return new AppException(
      ERROR_CODES.VALIDATION_FAILED,
      message,
      HttpStatus.BAD_REQUEST,
      [{ field, message }],
    );
  }
}
