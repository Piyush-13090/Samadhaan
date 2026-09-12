import { ValidationPipe } from '@nestjs/common';

/**
 * Shared validation policy for every endpoint:
 * - `whitelist` + `forbidNonWhitelisted` reject unknown fields outright, so a
 *   client typo fails loudly rather than being silently ignored.
 * - `transform` turns plain bodies into DTO instances with coerced types.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
}
