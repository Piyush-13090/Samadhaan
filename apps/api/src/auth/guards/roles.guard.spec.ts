import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@samadhaan/shared';
import { AppException } from '../../common/app.exception.js';
import type { RequestUser } from '../auth.types.js';
import { RolesGuard } from './roles.guard.js';

function createContext(user?: Partial<RequestUser>): ExecutionContext {
  const request = {
    user: user
      ? ({
          id: 'u1',
          email: 'a@b.c',
          status: 'ACTIVE',
          sessionId: 's1',
          ...user,
        } as RequestUser)
      : undefined,
  };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

/** A reflector that answers with the given metadata regardless of key lookup. */
function createReflector(metadata: {
  isPublic?: boolean;
  roles?: UserRole[];
}): Reflector {
  const reflector = new Reflector();

  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) =>
    String(key).includes('isPublic') ? metadata.isPublic : metadata.roles,
  );

  return reflector;
}

describe('RolesGuard', () => {
  it('allows a public route without inspecting the user', () => {
    const guard = new RolesGuard(createReflector({ isPublic: true }));

    expect(guard.canActivate(createContext())).toBe(true);
  });

  it('allows any authenticated user when no roles are declared', () => {
    const guard = new RolesGuard(createReflector({ roles: undefined }));

    expect(guard.canActivate(createContext({ role: 'CITIZEN' }))).toBe(true);
  });

  it('allows a user whose role is listed', () => {
    const guard = new RolesGuard(createReflector({ roles: ['GOVERNMENT', 'ADMIN'] }));

    expect(guard.canActivate(createContext({ role: 'GOVERNMENT' }))).toBe(true);
  });

  it('denies a citizen reaching a government-only route', () => {
    const guard = new RolesGuard(createReflector({ roles: ['GOVERNMENT'] }));

    expect(() => guard.canActivate(createContext({ role: 'CITIZEN' }))).toThrow(
      AppException,
    );
  });

  it('denies an NGO reaching an admin-only route', () => {
    const guard = new RolesGuard(createReflector({ roles: ['ADMIN'] }));

    expect(() => guard.canActivate(createContext({ role: 'NGO' }))).toThrow(AppException);
  });

  it('does not disclose which role is required', () => {
    const guard = new RolesGuard(createReflector({ roles: ['ADMIN'] }));

    try {
      guard.canActivate(createContext({ role: 'CITIZEN' }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppException).message).not.toContain('ADMIN');
    }
  });

  it('denies when no principal is present, rather than failing open', () => {
    const guard = new RolesGuard(createReflector({ roles: ['ADMIN'] }));

    expect(() => guard.canActivate(createContext())).toThrow(AppException);
  });
});
