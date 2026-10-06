import { Module } from '@nestjs/common';
import { AllocationsService } from './allocations.service.js';

/**
 * Government allocation (Prompt 16). The service is shared: the government
 * portal creates and cancels, the organisation workspace accepts and
 * declines, the public problem view reads the accepted assignment. Each
 * caller brings its own proven authority; the service enforces the state
 * machine.
 */
@Module({
  providers: [AllocationsService],
  exports: [AllocationsService],
})
export class AllocationsModule {}
