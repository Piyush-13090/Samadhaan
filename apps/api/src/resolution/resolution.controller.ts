import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import {
  API_VERSION,
  type ResolutionActivityEntry,
  type ResolutionAttachmentView,
  type ResolutionMessagePage,
  type ResolutionMessageView,
  type ResolutionParticipants,
  type ResolutionRoomSummary,
  type ResolutionRoomView,
  type ResolutionStreamEvent,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { UserRateLimit } from '../auth/guards/user-rate-limit.guard.js';
import { AppException } from '../common/app.exception.js';
import { ResolutionAccessService } from './resolution-access.service.js';
import { ResolutionAttachmentsService } from './resolution-attachments.service.js';
import { ResolutionRealtimeService } from './resolution-realtime.service.js';
import { ResolutionRoomsService } from './resolution-rooms.service.js';
import {
  CloseRoomDto,
  EditMessageDto,
  MessagesQueryDto,
  PostMessageDto,
} from './resolution.dto.js';

/** How often an open stream re-checks that its viewer is still a participant. */
const STREAM_RECHECK_MS = 60_000;
/** Comment frames keep proxies from closing an idle stream. */
const STREAM_HEARTBEAT_MS = 25_000;
/** Streams end after this; the browser reconnects with a fresh check. */
const STREAM_MAX_MS = 15 * 60_000;

/**
 * `/api/v1/resolution-rooms` — private rooms for the allocating office and the
 * assigned organisation. Every `:id` route resolves the caller's access first
 * (`ResolutionAccessService`); non-participants get 404.
 */
@Controller({ path: 'resolution-rooms', version: API_VERSION.replace('v', '') })
export class ResolutionController {
  constructor(
    private readonly access: ResolutionAccessService,
    private readonly rooms: ResolutionRoomsService,
    private readonly attachments: ResolutionAttachmentsService,
    private readonly realtime: ResolutionRealtimeService,
  ) {}

  @Get()
  mine(@CurrentUser() user: RequestUser): Promise<ResolutionRoomSummary[]> {
    return this.rooms.mine(user);
  }

  @Get(':id')
  async room(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ResolutionRoomView> {
    return this.rooms.view(await this.access.resolve(id, user), user);
  }

  @Get(':id/participants')
  async participants(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ResolutionParticipants> {
    return this.rooms.participants(await this.access.resolve(id, user));
  }

  @Get(':id/messages')
  async messages(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MessagesQueryDto,
  ): Promise<ResolutionMessagePage> {
    return this.rooms.messages(
      await this.access.resolve(id, user),
      query.cursor,
      query.limit,
    );
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @UserRateLimit({ bucket: 'room-message', max: 20, windowSeconds: 60 })
  async post(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostMessageDto,
  ): Promise<ResolutionMessageView> {
    return this.rooms.post(
      await this.access.resolve(id, user),
      {
        body: dto.body,
        mentionUserIds: dto.mentionUserIds ?? [],
        attachmentIds: dto.attachmentIds ?? [],
      },
      user,
    );
  }

  @Patch(':id/messages/:messageId')
  @UserRateLimit({ bucket: 'room-message-edit', max: 30, windowSeconds: 60 })
  async edit(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: EditMessageDto,
  ): Promise<ResolutionMessageView> {
    return this.rooms.edit(
      await this.access.resolve(id, user),
      messageId,
      dto.body,
      user,
    );
  }

  @Delete(':id/messages/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UserRateLimit({ bucket: 'room-message-edit', max: 30, windowSeconds: 60 })
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<void> {
    await this.rooms.remove(await this.access.resolve(id, user), messageId, user);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async read(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ unreadCount: number }> {
    return this.rooms.markRead(await this.access.resolve(id, user), user);
  }

  @Get(':id/activity')
  async activity(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ResolutionActivityEntry[]> {
    return this.rooms.activity(await this.access.resolve(id, user));
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'room-close', max: 10, windowSeconds: 60 })
  async close(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseRoomDto,
  ): Promise<ResolutionRoomView> {
    const context = await this.access.resolve(id, user);
    await this.rooms.close(context, dto.reason, user);
    return this.rooms.view(await this.access.resolve(id, user), user);
  }

  // ------------------------------------------------------------ attachments

  @Get(':id/attachments')
  async listAttachments(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ResolutionAttachmentView[]> {
    return this.attachments.list(await this.access.resolve(id, user), user);
  }

  @Post(':id/attachments')
  @HttpCode(HttpStatus.CREATED)
  @UserRateLimit({ bucket: 'room-attachment', max: 10, windowSeconds: 600 })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile()
    file: { buffer: Buffer; originalname?: string; size: number } | undefined,
  ): Promise<ResolutionAttachmentView> {
    // Access first, so a non-participant learns nothing from file errors.
    const context = await this.access.resolve(id, user);
    if (!file) throw AppException.badRequest('Choose a file to attach.');
    return this.attachments.upload(context, file, user);
  }

  /**
   * The file's bytes, after the participant check. Never cached publicly, never
   * sniffed, and sandboxed: a hostile file cannot run in this origin.
   */
  @Get(':id/attachments/:attachmentId/file')
  async file(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res() response: Response,
  ): Promise<void> {
    const { body, mimeType, fileName } = await this.attachments.file(
      await this.access.resolve(id, user),
      attachmentId,
      user,
    );
    const disposition = mimeType === 'application/pdf' ? 'attachment' : 'inline';
    response
      .status(200)
      .set({
        'Content-Type': mimeType,
        'Content-Length': String(body.length),
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      })
      .send(body);
  }

  // -------------------------------------------------------------- realtime

  /**
   * Server-Sent Events for one room.
   *
   * SSE rather than WebSockets: it rides the same same-origin proxy and
   * cookie authentication as every other request, needs no new protocol or
   * dependency, and the browser reconnects by itself. Access is checked on
   * connect and every minute after; a stream ends after 15 minutes so the
   * reconnect re-authenticates.
   */
  @Get(':id/stream')
  async stream(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.access.resolve(id, user);

    response.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.write(': connected\n\n');

    const send = (event: ResolutionStreamEvent) => {
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    let closed = false;
    const unsubscribe = this.realtime.listen(id, send);
    const heartbeat = setInterval(
      () => response.write(': ping\n\n'),
      STREAM_HEARTBEAT_MS,
    );
    const recheck = setInterval(() => {
      this.access.resolve(id, user).catch(() => end());
    }, STREAM_RECHECK_MS);
    const lifetime = setTimeout(() => end(), STREAM_MAX_MS);

    function end() {
      if (closed) return;
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
      clearInterval(recheck);
      clearTimeout(lifetime);
      response.end();
    }
    request.on('close', end);
  }
}
