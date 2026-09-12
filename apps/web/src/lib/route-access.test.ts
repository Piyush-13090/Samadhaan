import { describe, expect, it } from 'vitest';
import { ROLE_HOME_ROUTE, canRoleAccessPath, USER_ROLES } from '@samadhaan/shared';

/**
 * The route map drives sign-in redirects and workspace routing. These are the
 * same rules the server enforces in `requireRole`, so a mistake here would send
 * users somewhere they will immediately be bounced from.
 */
describe('role route access', () => {
  it('gives every role a home route', () => {
    for (const role of USER_ROLES) {
      expect(ROLE_HOME_ROUTE[role]).toMatch(/^\//);
    }
  });

  it('lets every role reach its own home', () => {
    for (const role of USER_ROLES) {
      expect(canRoleAccessPath(role, ROLE_HOME_ROUTE[role])).toBe(true);
    }
  });

  it('keeps a citizen out of the government and admin workspaces', () => {
    expect(canRoleAccessPath('CITIZEN', '/government')).toBe(false);
    expect(canRoleAccessPath('CITIZEN', '/admin')).toBe(false);
    expect(canRoleAccessPath('CITIZEN', '/organization')).toBe(false);
  });

  it('keeps an organisation out of government and admin', () => {
    expect(canRoleAccessPath('NGO', '/government')).toBe(false);
    expect(canRoleAccessPath('NGO', '/admin')).toBe(false);
  });

  it('keeps government out of admin', () => {
    expect(canRoleAccessPath('GOVERNMENT', '/admin')).toBe(false);
  });

  it('lets admin reach every workspace', () => {
    for (const route of Object.values(ROLE_HOME_ROUTE)) {
      expect(canRoleAccessPath('ADMIN', route)).toBe(true);
    }
  });

  it('matches nested paths under an allowed prefix', () => {
    expect(canRoleAccessPath('GOVERNMENT', '/government/allocations')).toBe(true);
    expect(canRoleAccessPath('CITIZEN', '/my-problems/SAM-1023')).toBe(true);
  });

  it('does not match a path that merely shares a prefix string', () => {
    expect(canRoleAccessPath('CITIZEN', '/dashboard-secrets')).toBe(false);
  });

  it('lets every role reach shared areas', () => {
    for (const role of USER_ROLES) {
      expect(canRoleAccessPath(role, '/profile')).toBe(true);
      expect(canRoleAccessPath(role, '/notifications')).toBe(true);
    }
  });
});
