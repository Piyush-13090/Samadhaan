import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/app.config.js';
import { ImageValidationService } from './image-validation.service.js';

/**
 * The upload validator is the boundary between an attacker's file and our
 * filesystem, so these tests are about what it *refuses* as much as what it
 * accepts.
 */
describe('ImageValidationService', () => {
  const service = new ImageValidationService({
    maxImageBytes: 8 * 1024 * 1024,
  } as AppConfig);

  let jpeg: Buffer;
  let png: Buffer;
  let webp: Buffer;
  let tiny: Buffer;

  beforeAll(async () => {
    const canvas = (width: number, height: number) =>
      sharp({
        create: { width, height, channels: 3, background: { r: 90, g: 120, b: 200 } },
      });

    [jpeg, png, webp, tiny] = await Promise.all([
      canvas(800, 600).jpeg().toBuffer(),
      canvas(640, 480).png().toBuffer(),
      canvas(320, 240).webp().toBuffer(),
      canvas(32, 32).jpeg().toBuffer(),
    ]);
  });

  describe('accepted formats', () => {
    it('accepts a JPEG and reports its real dimensions', async () => {
      const result = await service.validate(jpeg, 'photo.jpg');

      expect(result.contentType).toBe('image/jpeg');
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      expect(result.sizeBytes).toBe(jpeg.byteLength);
    });

    it('accepts a PNG', async () => {
      await expect(service.validate(png)).resolves.toMatchObject({
        contentType: 'image/png',
      });
    });

    it('accepts a WebP', async () => {
      await expect(service.validate(webp)).resolves.toMatchObject({
        contentType: 'image/webp',
      });
    });
  });

  describe('content, not the client’s claim', () => {
    /**
     * The whole point: a filename and a MIME header are attacker-controlled,
     * and a PHP script named `photo.jpg` must not become a stored file.
     */
    it('rejects a script disguised as a JPEG', async () => {
      const script = Buffer.from('<?php system($_GET["c"]); ?>');

      await expect(service.validate(script, 'photo.jpg')).rejects.toThrow(
        /not a valid JPEG, PNG or WebP/,
      );
    });

    it('rejects HTML disguised as an image', async () => {
      const html = Buffer.from('<html><script>alert(1)</script></html>');

      await expect(service.validate(html, 'image.png')).rejects.toThrow();
    });

    // SVG is a document format that can carry script. Served from our own
    // origin it would be a stored-XSS primitive, so it stays off the list.
    it('rejects SVG even though it is technically an image', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      );

      await expect(service.validate(svg, 'drawing.svg')).rejects.toThrow();
    });

    it('rejects a GIF, which is outside the allow-list', async () => {
      const gif = await sharp({
        create: { width: 200, height: 200, channels: 3, background: '#fff' },
      })
        .gif()
        .toBuffer();

      await expect(service.validate(gif, 'anim.gif')).rejects.toThrow(/not supported/i);
    });
  });

  describe('bounds', () => {
    it('rejects an empty file', async () => {
      await expect(service.validate(Buffer.alloc(0))).rejects.toThrow(/empty/i);
    });

    it('rejects a file over the byte limit', async () => {
      const small = new ImageValidationService({ maxImageBytes: 1024 } as AppConfig);

      await expect(small.validate(jpeg, 'photo.jpg')).rejects.toThrow(/MB or smaller/);
    });

    // A thumbnail carries no usable evidence of a civic problem.
    it('rejects an image below the minimum dimension', async () => {
      await expect(service.validate(tiny)).rejects.toThrow(/at least 64/);
    });
  });

  it('never leaks the parser’s own error text to the caller', async () => {
    try {
      await service.validate(Buffer.from('not an image at all'));
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;

      expect(message).not.toMatch(/sharp|libvips|VipsOperation/i);
      expect(message).toMatch(/JPEG, PNG or WebP/);
    }
  });
});
