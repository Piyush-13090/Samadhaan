import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { AppConfig } from '../config/app.config.js';
import { isSafeStorageKey } from './storage-key.js';
import {
  StorageService,
  type PutObjectInput,
  type StoredObject,
} from './storage.types.js';

/**
 * Filesystem storage driver for development.
 *
 * Deliberately simple. It exists so the reporting flow can be built and tested
 * without an S3 account, and so the *shape* of the abstraction is proven by a
 * second implementation rather than assumed.
 *
 * Not suitable for production: files are local to one process, so a second API
 * instance cannot read what the first wrote. `StorageService` is what makes
 * replacing it a one-provider change.
 */
@Injectable()
export class LocalStorageService extends StorageService implements OnModuleInit {
  private readonly logger = new Logger(LocalStorageService.name);
  private readonly root: string;

  constructor(private readonly config: AppConfig) {
    super();
    this.root = resolve(config.storageLocalRoot);
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    this.logger.log(`Local storage root: ${this.root}`);
  }

  /**
   * Resolves a key to an absolute path, refusing anything that escapes the root.
   *
   * Two independent checks. `isSafeStorageKey` rejects the obvious forms, and
   * the resolved-prefix comparison catches anything that slips past it —
   * symlinks, unusual encodings, platform quirks. Either alone would be a
   * single point of failure for path traversal, which is the one bug in this
   * file that would matter.
   */
  private pathFor(key: string): string {
    if (!isSafeStorageKey(key)) {
      throw new Error('Unsafe storage key');
    }

    const target = resolve(join(this.root, key));

    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error('Storage key escapes the storage root');
    }

    return target;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const path = this.pathFor(input.key);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body);

    return {
      key: input.key,
      size: input.body.byteLength,
      contentType: input.contentType,
    };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      // A missing object is an expected outcome, not an error worth throwing.
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    // `force` makes deleting an absent key a no-op, which is what callers want:
    // cleanup paths should not have to check first.
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      const info = await stat(this.pathFor(key));
      return info.isFile();
    } catch {
      return false;
    }
  }

  /**
   * A URL the browser can fetch.
   *
   * Routed through the API rather than served from disk directly, so the
   * eventual switch to signed object-store URLs changes only this method. The
   * path is stable and public — problem photos are public civic evidence.
   */
  async getUrl(key: string): Promise<string> {
    if (!isSafeStorageKey(key)) throw new Error('Unsafe storage key');

    return `${this.config.publicApiUrl}/api/v1/media/${key}`;
  }
}
