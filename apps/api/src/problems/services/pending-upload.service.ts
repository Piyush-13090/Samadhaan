import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app.config.js';
import { RedisService } from '../../redis/redis.service.js';
import { StorageService } from '../../storage/storage.types.js';

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
 * definition, and a TTL expires abandoned uploads without a cleanup job. The
 * cost is that a Redis flush orphans the files, which the sweep below handles.
 */
@Injectable()
export class PendingUploadService {
  private readonly logger = new Logger(PendingUploadService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
  ) {}

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
