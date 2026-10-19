import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/app.config.js';
import { S3StorageService, type S3Like } from './s3-storage.service.js';

const config = {
  publicApiUrl: 'https://api.samadhaan.test',
  s3Storage: {
    bucket: 'media',
    region: 'ap-south-1',
    accessKeyId: 'AKIATEST',
    secretAccessKey: 'secret',
    endpoint: undefined,
    forcePathStyle: false,
  },
} as unknown as AppConfig;

const KEY = 'problems/2026/10/0123456789abcdef0123456789abcdef.jpg';

function fake(handler: (command: unknown) => unknown) {
  const send = vi.fn(async (command: unknown) => handler(command));
  return { client: { send } satisfies S3Like, send };
}

const notFound = Object.assign(new Error('NoSuchKey'), {
  name: 'NoSuchKey',
  $metadata: { httpStatusCode: 404 },
});

describe('S3StorageService (Prompt 30)', () => {
  it('puts with the bucket, key, type and length', async () => {
    const { client, send } = fake(() => ({}));
    const storage = new S3StorageService(config, client);
    const stored = await storage.put({
      key: KEY,
      body: Buffer.from('jpeg'),
      contentType: 'image/jpeg',
    });
    expect(stored).toEqual({ key: KEY, size: 4, contentType: 'image/jpeg' });
    const command = send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'media',
      Key: KEY,
      ContentType: 'image/jpeg',
      ContentLength: 4,
    });
  });

  it('reads bytes, and treats a missing object as null', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { client } = fake((command) => {
      if ((command as GetObjectCommand).input.Key === KEY) {
        return { Body: { transformToByteArray: async () => bytes } };
      }
      throw notFound;
    });
    const storage = new S3StorageService(config, client);
    expect(await storage.get(KEY)).toEqual(Buffer.from(bytes));
    expect(
      await storage.get('problems/2026/10/ffffffffffffffffffffffffffffffff.jpg'),
    ).toBeNull();
  });

  it('does not disguise a real failure as a missing object', async () => {
    const denied = Object.assign(new Error('AccessDenied'), {
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    });
    const { client } = fake(() => {
      throw denied;
    });
    await expect(new S3StorageService(config, client).get(KEY)).rejects.toBe(denied);
    await expect(new S3StorageService(config, client).exists(KEY)).rejects.toBe(denied);
  });

  it('answers exists via HEAD and deletes idempotently', async () => {
    const { client, send } = fake((command) => {
      if (command instanceof HeadObjectCommand) throw notFound;
      return {};
    });
    const storage = new S3StorageService(config, client);
    expect(await storage.exists(KEY)).toBe(false);
    await storage.delete(KEY);
    expect(send.mock.calls.at(-1)?.[0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('refuses unsafe keys before any request is made', async () => {
    const { client, send } = fake(() => ({}));
    const storage = new S3StorageService(config, client);
    for (const key of ['../etc/passwd', '/absolute', 'problems/../../x']) {
      await expect(storage.get(key)).rejects.toThrow('Unsafe storage key');
      await expect(
        storage.put({ key, body: Buffer.from('x'), contentType: 'image/png' }),
      ).rejects.toThrow('Unsafe storage key');
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('serves through the API, never a bucket URL', async () => {
    const { client } = fake(() => ({}));
    expect(await new S3StorageService(config, client).getUrl(KEY)).toBe(
      `https://api.samadhaan.test/api/v1/media/${KEY}`,
    );
  });

  it('counts failed reads and writes for monitoring (Prompt 30)', async () => {
    const { MetricsService } = await import('../metrics/metrics.service.js');
    const metrics = new MetricsService();
    const failure = Object.assign(new Error('SlowDown'), {
      name: 'SlowDown',
      $metadata: { httpStatusCode: 503 },
    });
    const { client } = fake(() => {
      throw failure;
    });
    const storage = new S3StorageService(config, client, metrics);
    await expect(storage.get(KEY)).rejects.toBe(failure);
    await expect(
      storage.put({ key: KEY, body: Buffer.from('x'), contentType: 'image/jpeg' }),
    ).rejects.toBe(failure);
    await expect(storage.delete(KEY)).rejects.toBe(failure);
    expect(metrics.storageErrors.get({ operation: 'get' })).toBe(1);
    expect(metrics.storageErrors.get({ operation: 'put' })).toBe(1);
    expect(metrics.storageErrors.get({ operation: 'delete' })).toBe(1);
  });
});
