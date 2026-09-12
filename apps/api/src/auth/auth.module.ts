import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RateLimitGuard } from './guards/rate-limit.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { AuthCookiesService } from './services/auth-cookies.service.js';
import { PasswordService } from './services/password.service.js';
import { SessionService } from './services/session.service.js';
import { TokenService } from './services/token.service.js';

/**
 * Authentication and authorisation.
 *
 * The three guards are registered globally, in order:
 *
 *   1. `RateLimitGuard` — throttles before any expensive work happens.
 *   2. `JwtAuthGuard`   — establishes *who* is calling.
 *   3. `RolesGuard`     — decides *whether they may*.
 *
 * Global registration is the important decision: every route added from now on
 * is authenticated by default, and making one public requires writing
 * `@Public()`. The alternative — opting routes in — fails silently the first
 * time someone forgets a decorator, and that failure is an open endpoint.
 *
 * `JwtModule` is registered without a secret; `TokenService` passes it per call
 * from validated config, so the key has exactly one source.
 */
@Module({
  imports: [UsersModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookiesService,
    PasswordService,
    SessionService,
    TokenService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [
    AuthService,
    AuthCookiesService,
    PasswordService,
    SessionService,
    TokenService,
  ],
})
export class AuthModule {}
