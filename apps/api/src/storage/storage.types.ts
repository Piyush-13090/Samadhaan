/**
 * Provider-agnostic storage contract.
 *
 * The domain never learns whether bytes live on a local disk or in an S3
 * bucket. That matters beyond tidiness: `ProblemsService` stores a *key*, and
 * swapping the implementation must not require touching problem logic or
 * migrating a single database row.
 */

/** Where an object lives. Keys are generated server-side, never client-supplied. */
export interface StoredObject {
  /** Opaque key, e.g. `problems/2026/09/a3f2….jpg`. The durable reference. */
  key: string;
  /** Bytes written. */
  size: number;
  contentType: string;
}

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
  /**
   * Cache lifetime hint for the eventual CDN. Ignored by the local driver,
   * which is why it is a hint rather than a guarantee.
   */
  cacheSeconds?: number;
}

/**
 * Storage driver.
 *
 * Deliberately small. Every method an implementation must provide is one the
 * product genuinely needs today; a wider interface would make the S3 driver
 * harder to write for no benefit.
 */
export abstract class StorageService {
  /** Writes an object. Overwrites if the key exists. */
  abstract put(input: PutObjectInput): Promise<StoredObject>;

  /** Removes an object. Succeeds when the key is already absent. */
  abstract delete(key: string): Promise<void>;

  abstract exists(key: string): Promise<boolean>;

  /**
   * A URL a browser can fetch.
   *
   * Async because a real object store issues *signed* URLs, which involves
   * work. Making it async from the start means adopting S3 does not turn every
   * call site into a refactor.
   */
  abstract getUrl(key: string): Promise<string>;

  /** Reads an object back. Used by the local driver's serving route. */
  abstract get(key: string): Promise<Buffer | null>;
}
