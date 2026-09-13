import { Module } from '@nestjs/common';
import { MediaController } from './media.controller.js';

/** Development-only media serving. See `MediaController`. */
@Module({ controllers: [MediaController] })
export class MediaModule {}
