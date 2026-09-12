import { Module } from '@nestjs/common';

/**
 * Civic problem reporting: submission, media handling, geo-tagging, feeds, status transitions and the AI analysis pipeline hand-off.
 *
 * Boundary only in this milestone: the module is registered and wired into
 * `AppModule` so later prompts add controllers, services and DTOs here
 * without restructuring the application.
 */
@Module({})
export class ProblemsModule {}
