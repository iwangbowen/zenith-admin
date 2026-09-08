import { mockUsers, type MockUser } from '@/mocks/data/users';
import { mockMenus } from '@/mocks/data/menus';

export const MOCK_TOKEN_PREFIX = 'mock-access-token';
export const MOCK_REFRESH_TOKEN_PREFIX = 'mock-refresh-token';

interface MockTokenClaims { username: string; viewingTenantId?: number | null; }
export interface MockSession { user: MockUser; viewingTenantId?: number | null; }

export const mockAccessToken = (username: string, viewingTenantId?: number | null) =>
  `${MOCK_TOKEN_PREFIX}:${JSON.stringify({ username, viewingTenantId })}`;
export const mockRefreshToken = (username: string, viewingTenantId?: number | null) =>
  `${MOCK_REFRESH_TOKEN_PREFIX}:${JSON.stringify({ username, viewingTenantId })}`;

export function resolveMockSession(token: string | null | undefined, prefix = MOCK_TOKEN_PREFIX): MockSession | null {
  if (!token) return null;
  let claims: MockTokenClaims;
  if (token === prefix) claims = { username: 'admin' };
  else if (token.startsWith(`${prefix}:`)) {
    const payload = token.slice(prefix.length + 1);
    try {
      claims = payload.startsWith('{') ? JSON.parse(payload) as MockTokenClaims : { username: payload };
    } catch { return null; }
  } else return null;
  const user = mockUsers.find((item) => item.username === claims.username && item.status === 'enabled');
  if (!user) return null;
  if (claims.viewingTenantId != null && (!Number.isInteger(claims.viewingTenantId) || claims.viewingTenantId <= 0)) return null;
  if (claims.viewingTenantId != null && !isMockPlatformAdmin(user)) return null;
  return { user, viewingTenantId: claims.viewingTenantId };
}

export function currentMockSession(request: Request): MockSession | null {
  const authorization = request.headers.get('Authorization');
  return resolveMockSession(authorization?.startsWith('Bearer ') ? authorization.slice(7) : null);
}

export function isMockPlatformAdmin(user: MockUser): boolean {
  return (user.tenantId ?? null) === null && user.roles.some((role) => role.code === 'super_admin' && role.status === 'enabled');
}

export function mockUserPermissions(user: MockUser): string[] {
  if (isMockPlatformAdmin(user)) return ['*'];
  const ids = new Set(user.roles.filter((role) => role.status === 'enabled').flatMap((role) => role.menuIds ?? []));
  return mockMenus.flatMap((menu) => ids.has(menu.id) && menu.status === 'enabled' && menu.permission ? [menu.permission] : []);
}
