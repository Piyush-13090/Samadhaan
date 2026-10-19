import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app.config.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { LocalStorageService } from './local-storage.service.js';
import { S3StorageService } from './s3-storage.service.js';
import { StorageService } from './storage.types.js';

/**
 * Object storage.
 *
 * `StorageService` is an abstract class rather than an interface so it can be
 * a Nest injection token directly — no string tokens, and consumers get the
 * type for free.
 *
 * The factory is where a second driver plugs in. When S3 arrives it becomes a
 * switch on `config.storageProvider`, and nothing outside this file changes.
 */
@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      inject: [AppConfig, MetricsService],
      useFactory: (config: AppConfig, metrics: MetricsService): StorageService => {
        switch (config.storageProvider) {
          case 'local':
            return new LocalStorageService(config);
          case 's3':
            return new S3StorageService(config, undefined, metrics);
          default:
            // Fail at boot rather than at the first upload: a misconfigured
            // provider should stop a deploy, not surface as a broken feature.
            throw new Error(
              `Unsupported STORAGE_PROVIDER "${config.storageProvider}". Supported: local, s3.`,
            );
        }
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
