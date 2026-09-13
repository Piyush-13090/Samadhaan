import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import sharp, { type Metadata } from 'sharp';
import { ERROR_CODES } from '@samadhaan/shared';
import { AppException } from '../../common/app.exception.js';
import { AppConfig } from '../../config/app.config.js';

/** What we learned about a file by looking at its actual bytes. */
export interface ValidatedImage {
  /** Content type detected from the file itself, never the client's claim. */
  contentType: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/**
 * Formats accepted for problem photos.
 *
 * A deliberate allow-list. SVG is absent and must stay absent: it is a document
 * format that can carry script, and an SVG served from our own origin and
 * rendered in an `<img>` is a stored-XSS primitive. GIF is absent because
 * nothing in civic reporting needs animation.
 */
const ALLOWED_FORMATS: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Below this, a "photo" carries no usable evidence. */
const MIN_DIMENSION = 64;

/**
 * Guards against decompression bombs: a small file that expands to an enormous
 * raster and exhausts memory. 100 megapixels is far beyond any phone camera.
 */
const MAX_PIXELS = 100_000_000;

/**
 * Validates uploaded images by inspecting their content.
 *
 * **Nothing the client says is trusted.** The filename, the extension and the
 * `Content-Type` header are all attacker-controlled; a file named `photo.jpg`
 * with `image/jpeg` in its header can be a PHP script or a zip. The only
 * reliable signal is the bytes, so every file is decoded and its real format
 * read from the header sharp parses.
 */
@Injectable()
export class ImageValidationService {
  private readonly logger = new Logger(ImageValidationService.name);

  constructor(private readonly config: AppConfig) {}

  /**
   * Inspects a buffer and returns its true properties, or throws a
   * client-readable error.
   */
  async validate(buffer: Buffer, declaredName?: string): Promise<ValidatedImage> {
    if (buffer.byteLength === 0) {
      throw this.reject('That file is empty.');
    }

    if (buffer.byteLength > this.config.maxImageBytes) {
      const limitMb = Math.round(this.config.maxImageBytes / (1024 * 1024));
      throw this.reject(`Images must be ${limitMb} MB or smaller.`);
    }

    let metadata: Metadata;
    try {
      // `limitInputPixels` makes sharp refuse a decompression bomb during
      // parsing rather than after allocating for it.
      metadata = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata();
    } catch (error) {
      // Anything sharp cannot parse is not an image, whatever it was named.
      this.logger.debug(
        `Rejected upload ${declaredName ?? '(unnamed)'}: ${
          error instanceof Error ? error.message : 'unparseable'
        }`,
      );
      throw this.reject('That file is not a valid JPEG, PNG or WebP image.');
    }

    const contentType = metadata.format ? ALLOWED_FORMATS[metadata.format] : undefined;

    if (!contentType) {
      throw this.reject(
        `${metadata.format ? `${metadata.format.toUpperCase()} files are not supported.` : 'That file type is not supported.'} Use JPEG, PNG or WebP.`,
      );
    }

    const { width, height } = metadata;

    if (!width || !height) {
      throw this.reject('That image appears to be corrupted.');
    }

    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
      throw this.reject(
        `Images must be at least ${MIN_DIMENSION}×${MIN_DIMENSION} pixels.`,
      );
    }

    if (width * height > MAX_PIXELS) {
      throw this.reject('That image is too large to process.');
    }

    return { contentType, width, height, sizeBytes: buffer.byteLength };
  }

  /**
   * A 400 with a message safe to show a citizen.
   *
   * Deliberately never includes the parser's own error text: it describes our
   * internals and means nothing to the person who just tried to upload a photo.
   */
  private reject(message: string): AppException {
    return new AppException(
      ERROR_CODES.VALIDATION_FAILED,
      message,
      HttpStatus.BAD_REQUEST,
      [{ field: 'image', message }],
    );
  }
}
