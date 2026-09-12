import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger } from 'nestjs-pino';
import { API_GLOBAL_PREFIX, API_VERSION } from '@samadhaan/shared';
import { AppModule } from './app.module.js';
import { configureApp, registerNotFoundHandler } from './bootstrap.js';
import { AppConfig } from './config/app.config.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(PinoLogger));

  const config = app.get(AppConfig);

  configureApp(app);

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });

  // Closes Prisma and Redis connections on SIGTERM before the process exits.
  app.enableShutdownHooks();

  await app.init();
  registerNotFoundHandler(app);

  await app.listen(config.port, config.host);

  new Logger('Bootstrap').log(
    `Samadhaan API listening on http://${config.host}:${config.port}/${API_GLOBAL_PREFIX}/${API_VERSION}`,
  );
}

await bootstrap();
