import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { AppConfig } from '../config/app.config.js';
import type { MetricsService } from '../metrics/metrics.service.js';
import { isSafeStorageKey } from './storage-key.js';
import {
  StorageService,
  type PutObjectInput,
  type StoredObject,
} from './storage.types.js';

/** The subset of the S3 client this driver uses, so tests can supply a fake. */
export interface S3Like {
  send(command: unknown): Promise<unknown>;
  destroy?(): void;
}

/**
 * S3-compatible object storage (Prompt 30): AWS S3, Cloudflare R2, MinIO and
 * other providers that speak the S3 API (`STORAGE_ENDPOINT` for non-AWS).
 *
 * The bucket stays **private**. Files are never served from bucket URLs:
 * `getUrl` returns the API's own `/media/...` route, and every read goes
 * through the API — the public problem-photo route or the authorised
 * attachment and evidence routes — exactly as with the local driver, so the
 * authorisation model does not change with the storage backend.
 *
 * Keys are validated with the same `isSafeStorageKey` as the local driver.
 * A missing object reads as `null` (callers answer 404); any other failure
 * throws so it is logged and surfaced as a 5xx, never mistaken for "missing".
 */
@Injectable()
export class S3StorageService extends StorageService implements OnModuleDestroy {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly bucket: string;

  constructor(
    private readonly config: AppConfig,
    private readonly client: S3Like = S3StorageService.clientFor(config),
    private readonly metrics?: MetricsService,
  ) {
    super();
    const settings = config.s3Storage;
    if (!settings) throw new Error('STORAGE_PROVIDER=s3 requires the STORAGE_* settings');
    this.bucket = settings.bucket;
  }

  static clientFor(config: AppConfig): S3Client {
    const s = config.s3Storage;
    if (!s) throw new Error('STORAGE_PROVIDER=s3 requires the STORAGE_* settings');
    return new S3Client({
      region: s.region,
      ...(s.endpoint ? { endpoint: s.endpoint, forcePathStyle: s.forcePathStyle } : {}),
      credentials: { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey },
      maxAttempts: 3,
    });
  }

  onModuleDestroy(): void {
    this.client.destroy?.();
  }

  private key(key: string): string {
    if (!isSafeStorageKey(key)) throw new Error('Unsafe storage key');
    return key;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const key = this.key(input.key);
    await this.observed('put', () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: input.body,
          ContentType: input.contentType,
          ContentLength: input.body.byteLength,
          ...(input.cacheSeconds
            ? { CacheControl: `private, max-age=${input.cacheSeconds}` }
            : {}),
        }),
      ),
    );
    return {
      key: input.key,
      size: input.body.byteLength,
      contentType: input.contentType,
    };
  }

  async get(key: string): Promise<Buffer | null> {
    const safe = this.key(key);
    try {
      const result = (await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: safe }),
      )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
      if (!result.Body) return null;
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (isNotFound(error)) return null;
      this.metrics?.storageErrors.inc({ operation: 'get' });
      this.logger.error(
        `Storage read failed for a ${prefixOf(key)} object: ${describe(error)}`,
      );
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    // S3 DeleteObject is idempotent: deleting an absent key succeeds.
    const safe = this.key(key);
    await this.observed('delete', () =>
      this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safe })),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(key) }),
      );
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      this.metrics?.storageErrors.inc({ operation: 'exists' });
      throw error;
    }
  }

  /** Counts a failed write for monitoring (Prompt 30), then rethrows it. */
  private async observed<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      this.metrics?.storageErrors.inc({ operation });
      this.logger.error(`Storage ${operation} failed: ${describe(error)}`);
      throw error;
    }
  }

  async getUrl(key: string): Promise<string> {
    return `${this.config.publicApiUrl}/api/v1/media/${this.key(key)}`;
  }
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === 'NoSuchKey' ||
    e?.name === 'NotFound' ||
    e?.$metadata?.httpStatusCode === 404
  );
}

/** First key segment only (`problems`, `evidence`, ...): never the full key in logs. */
function prefixOf(key: string): string {
  return key.split('/')[0] ?? 'unknown';
}

function describe(error: unknown): string {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return `${e?.name ?? 'Error'}${e?.$metadata?.httpStatusCode ? ` (${e.$metadata.httpStatusCode})` : ''}`;
}
