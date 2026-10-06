import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { RESOLUTION_ATTACHMENT_MAX_BYTES } from '@samadhaan/shared';
import { ProjectRemindersService } from './project-reminders.service.js';
import { ProjectsController, RoomProjectController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { ResolutionAccessService } from './resolution-access.service.js';
import { ResolutionAttachmentsService } from './resolution-attachments.service.js';
import { ResolutionController } from './resolution.controller.js';
import { ResolutionRealtimeService } from './resolution-realtime.service.js';
import { ResolutionRoomsService } from './resolution-rooms.service.js';

/**
 * Resolution rooms (Prompt 17). Rooms are opened by AllocationsService inside
 * the acceptance transaction (`openRoomInTransaction`); this module is
 * everything that happens in them afterwards.
 */
@Module({
  imports: [
    MulterModule.register({
      limits: { fileSize: RESOLUTION_ATTACHMENT_MAX_BYTES, files: 1, fields: 5 },
    }),
  ],
  controllers: [ResolutionController, RoomProjectController, ProjectsController],
  providers: [
    ProjectsService,
    ProjectRemindersService,
    ResolutionAccessService,
    ResolutionRoomsService,
    ResolutionAttachmentsService,
    ResolutionRealtimeService,
  ],
  // Dashboards in the government and organisation modules show live projects.
  exports: [ProjectsService],
})
export class ResolutionModule {}
