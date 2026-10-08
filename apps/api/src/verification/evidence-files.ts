import { createHash } from 'node:crypto';
import exifr from 'exifr';
import sharp from 'sharp';
import {
  EVIDENCE_DOCUMENT_MAX_BYTES,
  EVIDENCE_IMAGE_MAX_BYTES,
  EVIDENCE_VIDEO_MAX_BYTES,
  type EvidenceUploadType,
} from '@samadhaan/shared';
import { differenceHash } from './verification-scoring.js';

/** Storage keys for evidence. Never served by the public media route. */
export const EVIDENCE_STORAGE_PREFIX = 'evidence/';

/** Extensions a declared filename may have, per detected type. */
const EXTENSIONS: Record<EvidenceUploadType, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'video/mp4': ['mp4', 'm4v', 'mov'],
};
export const STORED_EXTENSION: Record<EvidenceUploadType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
};
export const MAX_BYTES: Record<EvidenceUploadType, number> = {
  'image/jpeg': EVIDENCE_IMAGE_MAX_BYTES,
  'image/png': EVIDENCE_IMAGE_MAX_BYTES,
  'image/webp': EVIDENCE_IMAGE_MAX_BYTES,
  'application/pdf': EVIDENCE_DOCUMENT_MAX_BYTES,
  'video/mp4': EVIDENCE_VIDEO_MAX_BYTES,
};

/** ISO base-media brands of ordinary MP4/QuickTime video. */
const VIDEO_BRANDS = new Set([
  'isom',
  'iso2',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'qt  ',
  'mp4v',
  'dash',
]);
const MAX_PIXELS = 50_000_000;

/**
 * The type, from the file's own bytes. The client's Content-Type and filename
 * are claims; only these signatures are evidence.
 */
export function detectEvidenceType(buffer: Buffer): EvidenceUploadType | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'application/pdf';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(4, 8).toString('latin1') === 'ftyp' &&
    VIDEO_BRANDS.has(buffer.subarray(8, 12).toString('latin1'))
  ) {
    return 'video/mp4';
  }
  return null;
}

export function extensionMatches(type: EvidenceUploadType, fileName: string): boolean {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return EXTENSIONS[type].includes(ext);
}

/**
 * A display name safe anywhere it is shown or put in a header: the last path
 * segment only, no control or reserved characters, bounded. The stored key
 * never uses it.
 */
export function safeFileName(raw: string | undefined, fallbackExt: string): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    // Control characters are exactly what this removes.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*;]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || `evidence.${fallbackExt}`;
}

export const sha256 = (buffer: Buffer) =>
  createHash('sha256').update(buffer).digest('hex');

export interface ProcessedImage {
  /** Re-encoded without metadata (EXIF, GPS, maker notes), orientation applied. */
  stored: Buffer;
  width: number;
  height: number;
  perceptualHash: bigint;
  capturedAt: Date | null;
  gps: { latitude: number; longitude: number } | null;
  device: string | null;
}

/**
 * Reads what the original's metadata claims, then stores a copy without it.
 * Unreadable images throw — they are refused, whatever they were named.
 */
export async function processImage(
  buffer: Buffer,
  type: EvidenceUploadType,
): Promise<ProcessedImage> {
  const input = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error' });
  const meta = await input.metadata();
  if (!meta.width || !meta.height) throw new Error('Not a readable image');

  const exif = await readExif(buffer);
  // sharp drops all metadata unless asked to keep it; `rotate()` bakes the
  // EXIF orientation in first so the picture still looks right.
  const pipeline = sharp(buffer, { limitInputPixels: MAX_PIXELS }).rotate();
  const stored =
    type === 'image/png'
      ? await pipeline.png().toBuffer()
      : type === 'image/webp'
        ? await pipeline.webp({ quality: 90 }).toBuffer()
        : await pipeline.jpeg({ quality: 90 }).toBuffer();
  const { width, height } = await sharp(stored).metadata();
  return {
    stored,
    width: width ?? meta.width,
    height: height ?? meta.height,
    perceptualHash: await perceptualHash(stored),
    ...exif,
  };
}

export async function perceptualHash(image: Buffer): Promise<bigint> {
  const pixels = await sharp(image, { limitInputPixels: MAX_PIXELS })
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer();
  return differenceHash(new Uint8Array(pixels));
}

/** Capture time, GPS and device, when the file claims them. Never trusted as proof. */
export async function readExif(
  buffer: Buffer,
): Promise<Pick<ProcessedImage, 'capturedAt' | 'gps' | 'device'>> {
  try {
    const data = (await exifr.parse(buffer, {
      gps: true,
      // The raw GPS tags must be read for exifr to compute latitude/longitude.
      pick: [
        'DateTimeOriginal',
        'CreateDate',
        'Make',
        'Model',
        'GPSLatitude',
        'GPSLatitudeRef',
        'GPSLongitude',
        'GPSLongitudeRef',
      ],
    })) as Record<string, unknown> | undefined;
    if (!data) return { capturedAt: null, gps: null, device: null };
    const when = data.DateTimeOriginal ?? data.CreateDate;
    const capturedAt =
      when instanceof Date && !Number.isNaN(when.getTime()) ? when : null;
    const lat = typeof data.latitude === 'number' ? data.latitude : null;
    const lng = typeof data.longitude === 'number' ? data.longitude : null;
    // (0, 0) is a default, not a place; out-of-range values are malformed.
    const gps =
      lat !== null &&
      lng !== null &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180 &&
      !(lat === 0 && lng === 0)
        ? { latitude: lat, longitude: lng }
        : null;
    const device =
      [data.Make, data.Model]
        .filter((v): v is string => typeof v === 'string')
        .join(' ')
        .trim()
        .slice(0, 80) || null;
    return { capturedAt, gps, device };
  } catch {
    return { capturedAt: null, gps: null, device: null };
  }
}

/** A bounded JPEG for the AI service. */
export async function forModel(image: Buffer, maxPx: number): Promise<string> {
  const out = await sharp(image, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return out.toString('base64');
}
