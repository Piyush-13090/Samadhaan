import { Module } from '@nestjs/common';
import { ProblemsModule } from '../problems/problems.module.js';
import { UsersModule } from '../users/users.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

/**
 * The citizen home page's single endpoint.
 *
 * Its own module rather than another route on `ProblemsModule`: the dashboard
 * composes across problems and users, and putting it in either would make that
 * module depend on the other for a reason unrelated to its domain.
 */
@Module({
  imports: [ProblemsModule, UsersModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
