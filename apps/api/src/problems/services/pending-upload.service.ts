import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfig } from '../../config/app.config.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { StorageService } from '../../storage/storage.types.js';

/** Every upload, scored by upload time, until it is attached or removed. */
const INDEX_KEY = 'upload:pending:index';
const SWEEP_INTERVAL_MS = 30 * 60_000;
/** Extra time after the claim window, so a submit in flight is never raced. */
const SWEEP_GRACE_MS = 10 * 60_000;

/**
 * An image that has been uploaded but not yet attached to a problem.
 */
export interface PendingUpload {
  storageKey: string;
  contentType: string;
  originalFileName: string | null;
  sizeBytes: number;
  width: number;
  height: number;
  /** Who uploaded it. Checked before the key may be attached to a problem. */
  userId: string;
  uploadedAt: string;
}

/**
 * Tracks uploaded-but-unattached images.
 *
 * Reporting is two-phase — upload first, submit the report second — because a
 * citizen needs to see previews and a progress bar before committing, and
 * because a failed submit must not mean re-uploading six photos over a phone
 * connection.
 *
 * That split creates one question the system must answer: *may this person
 * attach this key?* Without it, anyone could post a storage key belonging to
 * someone else's upload and claim their photo. Recording the uploader here and
 * checking it at submission is what closes that.
 *
 * Redis rather than a database table: these records are ephemeral by
 * definition. The record's TTL ends the *claim*; the stored file outlives it,
 * so every upload is also listed in a sorted set by upload time, and a
 * periodic sweep deletes files that were never attached (Prompt 26). Without
 * it, abandoned uploads filled the disk and stayed publicly fetchable.
 */
@Injectable()
export class PendingUploadService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PendingUploadService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.nodeEnv === 'test') return; // suites drive the sweep directly
    const run = () => {
      void this.sweep().catch((error: Error) =>
        this.logger.warn(`Orphaned upload sweep failed: ${error.message}`),
      );
    };
    setTimeout(run, 60_000).unref();
    this.timer = setInterval(run, SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Deletes stored files whose upload is older than the claim window and that
   * no problem references. Bounded per run; safe to run on several instances
   * (each step is idempotent, and a referenced file is never deleted).
   */
  async sweep(now = Date.now()): Promise<number> {
    const cutoff = now - this.config.pendingUploadTtlSeconds * 1000 - SWEEP_GRACE_MS;
    const stale = await this.redis.connection.zrangebyscore(
      INDEX_KEY,
      0,
      cutoff,
      'LIMIT',
      0,
      200,
    );
    if (stale.length === 0) return 0;
    const attached = new Set(
      (
        await this.prisma.problemImage.findMany({
          where: { storageKey: { in: stale } },
          select: { storageKey: true },
        })
      ).map((image) => image.storageKey),
    );
    let deleted = 0;
    for (const key of stale) {
      if (!attached.has(key)) {
        await this.storage.delete(key).catch(() => undefined);
        deleted += 1;
      }
      await this.redis.connection.zrem(INDEX_KEY, key);
    }
    if (deleted > 0) this.logger.log(`Removed ${deleted} abandoned upload(s)`);
    return deleted;
  }

  private key(storageKey: string): string {
    return `upload:pending:${storageKey}`;
  }

  async record(upload: PendingUpload): Promise<void> {
    await this.redis.connection.set(
      this.key(upload.storageKey),
      JSON.stringify(upload),
      'EX',
      this.config.pendingUploadTtlSeconds,
    );
    await this.redis.connection.zadd(INDEX_KEY, Date.now(), upload.storageKey);
  }

  /** The record for a key, or `null` if it never existed or has expired. */
  async find(storageKey: string): Promise<PendingUpload | null> {
    const raw = await this.redis.connection.get(this.key(storageKey));
    if (!raw) return null;

    try {
      return JSON.parse(raw) as PendingUpload;
    } catch {
      // Corrupt entry — treat as absent rather than failing the submission.
      return null;
    }
  }

  /**
   * Marks uploads as attached, so the same key cannot be claimed twice.
   *
   * Called inside problem creation. Deleting rather than flagging is
   * deliberate: once a key is on a `ProblemImage` row, the database is the
   * record of ownership and the Redis entry has no further purpose.
   */
  async claim(storageKeys: string[]): Promise<void> {
    if (storageKeys.length === 0) return;

    await this.redis.connection.del(...storageKeys.map((key) => this.key(key)));
    await this.redis.connection.zrem(INDEX_KEY, ...storageKeys);
  }

  /**
   * Deletes the stored objects for uploads that were never attached.
   *
   * Best-effort cleanup, used when problem creation fails after files were
   * written. Failures are logged, never thrown — a leaked file is a housekeeping
   * problem, whereas masking the original error with a cleanup error would cost
   * the user the real reason their report failed.
   */
  async discard(storageKeys: string[]): Promise<void> {
    await Promise.all(
      storageKeys.map(async (key) => {
        try {
          await this.storage.delete(key);
          await this.redis.connection.del(this.key(key));
          await this.redis.connection.zrem(INDEX_KEY, key);
        } catch (error) {
          this.logger.warn(
            `Could not discard upload ${key}: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        }
      }),
    );
  }
}
