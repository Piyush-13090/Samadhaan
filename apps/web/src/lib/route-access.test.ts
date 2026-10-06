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
  });

  // The organisation workspace is gated by membership, which only the API
  // knows — a citizen invited to an NGO is a member of it. The route map lets
  // them reach the page; the page asks the API.
  it('lets a citizen reach the organisation workspace, which checks membership', () => {
    expect(canRoleAccessPath('CITIZEN', '/organization')).toBe(true);
    expect(canRoleAccessPath('CITIZEN', '/organization/clean-city/dashboard')).toBe(true);
  });

  it('lets organisation roles open problems and the map from their workspace', () => {
    for (const role of ['NGO', 'UNIVERSITY', 'INDUSTRY'] as const) {
      expect(canRoleAccessPath(role, '/problems/SAM-1023')).toBe(true);
      expect(canRoleAccessPath(role, '/map')).toBe(true);
      expect(canRoleAccessPath(role, '/organization/x/team')).toBe(true);
      expect(canRoleAccessPath(role, '/report')).toBe(false);
    }
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
