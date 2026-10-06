import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import {
  RESOLUTION_ATTACHMENT_MAX_BYTES,
  type ResolutionAttachmentType,
  type ResolutionAttachmentView,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import { StorageService } from '../storage/storage.types.js';
import type { RoomContext } from './resolution-access.service.js';
import { toAttachmentView } from './resolution-rooms.service.js';

/** Extensions a declared filename may have, per detected type. */
const EXTENSIONS: Record<ResolutionAttachmentType, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};

const STORED_EXTENSION: Record<ResolutionAttachmentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Storage keys for room files. Never served by the public media route. */
export const RESOLUTION_STORAGE_PREFIX = 'resolution/';

/**
 * Detects the type from the file's own bytes. The client's Content-Type and
 * filename are claims; only these signatures are evidence.
 */
export function detectAttachmentType(buffer: Buffer): ResolutionAttachmentType | null {
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
  return null;
}

/** A display name: no path, no control characters, bounded. */
export function sanitizeFileName(
  raw: string | undefined,
  type: ResolutionAttachmentType,
): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  const clean = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F<>:"|?*]/g, '')
    .trim()
    .slice(0, 120);
  return clean.length > 0 ? clean : `attachment.${STORED_EXTENSION[type]}`;
}

interface UploadedFile {
  buffer: Buffer;
  originalname?: string;
  size: number;
}

/**
 * The attachments foundation (Prompt 17): upload, list, serve. Not an
 * evidence-management system — no review, versions or before/after pairing.
 *
 * Metadata in PostgreSQL; bytes through `StorageService` under a
 * server-generated key. Files are served only through the room's endpoint,
 * after the same participant check as every other room request.
 */
@Injectable()
export class ResolutionAttachmentsService {
  private readonly logger = new Logger(ResolutionAttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async upload(
    context: RoomContext,
    file: UploadedFile,
    user: RequestUser,
  ): Promise<ResolutionAttachmentView> {
    if (context.room.status !== 'OPEN') {
      throw AppException.conflict('This room is closed.');
    }
    if (file.size === 0 || file.buffer.length === 0) {
      throw AppException.badRequest('That file is empty.');
    }
    if (file.buffer.length > RESOLUTION_ATTACHMENT_MAX_BYTES) {
      throw AppException.badRequest('Attachments must be 10 MB or smaller.');
    }

    const type = detectAttachmentType(file.buffer);
    if (!type) {
      throw AppException.badRequest(
        'Attach a JPEG, PNG or WebP image, or a PDF document.',
      );
    }

    const declaredExtension =
      (file.originalname ?? '').split('.').pop()?.toLowerCase() ?? '';
    if (file.originalname && !EXTENSIONS[type].includes(declaredExtension)) {
      throw AppException.badRequest("The file's name does not match its contents.");
    }

    if (type !== 'application/pdf') {
      try {
        // Decodes the header: a JPEG signature on something that is not a
        // JPEG is refused here.
        const metadata = await sharp(file.buffer, {
          limitInputPixels: 40_000_000,
        }).metadata();
        if (!metadata.width || !metadata.height) throw new Error('no dimensions');
      } catch {
        throw AppException.badRequest('That image could not be read.');
      }
    }

    const now = new Date();
    const key = `${RESOLUTION_STORAGE_PREFIX}${context.room.id}/${now.getUTCFullYear()}/${String(
      now.getUTCMonth() + 1,
    ).padStart(2, '0')}/${randomBytes(16).toString('hex')}.${STORED_EXTENSION[type]}`;

    await this.storage.put({ key, body: file.buffer, contentType: type });

    try {
      const attachment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.resolutionAttachment.create({
          data: {
            roomId: context.room.id,
            uploadedById: user.id,
            fileName: sanitizeFileName(file.originalname, type),
            mimeType: type,
            size: file.buffer.length,
            storageKey: key,
          },
          include: { uploadedBy: { select: { id: true, fullName: true } } },
        });
        await tx.resolutionRoomEvent.create({
          data: {
            roomId: context.room.id,
            type: 'ATTACHMENT_ADDED',
            actorId: user.id,
            metadata: {
              attachmentId: created.id,
              fileName: created.fileName,
              organizationName: context.organization.name,
            },
          },
        });
        return created;
      });
      return toAttachmentView(attachment, context.room.id);
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
  }

  /** Attachments on live messages. Unsent uploads are visible to their uploader only. */
  async list(
    context: RoomContext,
    user: RequestUser,
  ): Promise<ResolutionAttachmentView[]> {
    const rows = await this.prisma.resolutionAttachment.findMany({
      where: {
        roomId: context.room.id,
        OR: [
          { message: { deletedAt: null } },
          { messageId: null, uploadedById: user.id },
        ],
      },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return rows.map((row) => toAttachmentView(row, context.room.id));
  }

  /** The bytes, for a participant. Same rule as `list`. */
  async file(
    context: RoomContext,
    attachmentId: string,
    user: RequestUser,
  ): Promise<{ body: Buffer; mimeType: string; fileName: string }> {
    const attachment = await this.prisma.resolutionAttachment.findFirst({
      where: {
        id: attachmentId,
        roomId: context.room.id,
        OR: [
          { message: { deletedAt: null } },
          { messageId: null, uploadedById: user.id },
        ],
      },
    });
    if (!attachment) throw AppException.notFound('Attachment');

    const body = await this.storage.get(attachment.storageKey);
    if (!body) {
      this.logger.warn(`Attachment ${attachment.id} has no stored object`);
      throw AppException.notFound('Attachment');
    }
    return { body, mimeType: attachment.mimeType, fileName: attachment.fileName };
  }
}
