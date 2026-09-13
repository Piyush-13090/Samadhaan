import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { API_VERSION } from '@samadhaan/shared';
import { Public } from '../auth/decorators/public.decorator.js';
import { AppException } from '../common/app.exception.js';
import { isSafeStorageKey } from '../storage/storage-key.js';
import { StorageService } from '../storage/storage.types.js';

/**
 * Serves stored objects in development.
 *
 * Exists because the local driver has no HTTP surface of its own. With an
 * object store this route disappears: `getUrl` returns a signed CDN URL and the
 * browser never touches the API for media.
 *
 * Public, because problem photos are public civic evidence. What it must never
 * become is a way to read arbitrary files, which is what the key validation and
 * the header hardening below are for.
 */
@Public()
@Controller({ path: 'media', version: API_VERSION.replace('v', '') })
export class MediaController {
  constructor(private readonly storage: StorageService) {}

  /**
   * `*path` captures the whole key, which contains slashes.
   *
   * Three defences against traversal, in order: the key is validated here, the
   * storage driver validates it again, and the driver additionally confirms the
   * resolved path stays inside its root.
   */
  @Get('*path')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  // Stops a browser from re-interpreting the bytes as something other than the
  // declared type — the mechanism behind several image-upload XSS attacks.
  @Header('X-Content-Type-Options', 'nosniff')
  // Belt and braces: even if a hostile file were served, this forbids it doing
  // anything. Media never needs script, frames or plugins.
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  async serve(
    @Param('path') path: string | string[],
    @Res() response: Response,
  ): Promise<void> {
    const key = Array.isArray(path) ? path.join('/') : path;

    if (!isSafeStorageKey(key)) throw AppException.notFound('File');

    const body = await this.storage.get(key);
    if (!body) throw AppException.notFound('File');

    response.type(contentTypeFor(key)).send(body);
  }
}

/**
 * Content type from the key's extension.
 *
 * Safe because keys are generated server-side from a *detected* type — the
 * extension was chosen by us, not by an uploader. Anything unrecognised is
 * served as an opaque download rather than guessed at.
 */
function contentTypeFor(key: string): string {
  if (key.endsWith('.jpg')) return 'image/jpeg';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}
