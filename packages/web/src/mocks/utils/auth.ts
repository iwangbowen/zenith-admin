import { mockUsers, type MockUser } from '@/mocks/data/users';
import { mockMenus } from '@/mocks/data/menus';
import { mockRoles } from '@/mocks/data/roles';
import { mockUserGroups } from '@/mocks/data/user-groups';
import { mockTenants } from '@/mocks/data/tenants';
import { mockTenantPackages } from '@/mocks/data/tenant-packages';
import { mockAccessGrants, mockUserPageIds, mockUserPermissionCodes } from '@/mocks/data/access';
import { permissionFeatureKeys } from '@zenith/shared/permission-features';
import { mockDateTime } from './date';
import { config } from '@/config';

export const MOCK_TOKEN_PREFIX = 'mock-access-token';
export const MOCK_REFRESH_TOKEN_PREFIX = 'mock-refresh-token';

/** 模拟登录声明（Demo 模式）：与服务端 JwtPayload.impersonation 同形，另带展示所需的到期 / 原因 */
export interface MockImpersonationClaim {
  id: number;
  byUserId: number;
  byUsername: string;
  readOnly: boolean;
  reason: string;
  startedAt: string;
  expiresAt: string;
}

interface MockTokenClaims { username: string; viewingTenantId?: number | null; impersonation?: MockImpersonationClaim }
export interface MockSession { user: MockUser; viewingTenantId?: number | null; impersonation?: MockImpersonationClaim }

export const mockAccessToken = (username: string, viewingTenantId?: number | null, impersonation?: MockImpersonationClaim) =>
  `${MOCK_TOKEN_PREFIX}:${JSON.stringify({ username, viewingTenantId, ...(impersonation ? { impersonation } : {}) })}`;
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
  // 模拟令牌只在 access token 上出现；refresh token 携带该声明一律无效（与服务端一致：模拟会话不可续签）
  if (claims.impersonation && prefix === MOCK_REFRESH_TOKEN_PREFIX) return null;
  return { user, viewingTenantId: claims.viewingTenantId, impersonation: claims.impersonation };
}

export function currentMockSession(request: Request): MockSession | null {
  const authorization = request.headers.get('Authorization');
  return resolveMockSession(authorization?.startsWith('Bearer ') ? authorization.slice(7) : null);
}

export function isMockPlatformAdmin(user: MockUser): boolean {
  return (user.tenantId ?? null) === null && user.roles.some((role) => role.code === 'super_admin' && role.status === 'enabled');
}

export function mockPackageFeatures(tenantId: number | null | undefined) {
  if (!config.multiTenantMode || tenantId == null) return null;
  const tenant = mockTenants.find(item => item.id === tenantId);
  const pkg = mockTenantPackages.find(item => item.id === tenant?.packageId);
  return pkg ? new Set<string>(pkg.status === 'enabled' ? pkg.features ?? [] : []) : null;
}

export function mockPermissionAvailable(code: string, features: ReadonlySet<string> | null) {
  const required = permissionFeatureKeys(code);
  return !features || [...required].some(feature => feature === null || features.has(feature));
}

export function mockAvailableMenus(tenantId?: number | null) {
  const features = mockPackageFeatures(tenantId);
  const pages = mockMenus.filter(menu => menu.status === 'enabled' && (!features || !menu.featureKey || features.has(menu.featureKey)));
  const byId = new Map(pages.map(menu => [menu.id, menu]));
  return pages.filter(menu => {
    const seen = new Set([menu.id]);
    for (let parentId = menu.parentId; parentId !== 0;) {
      const parent = byId.get(parentId);
      if (!parent || seen.has(parentId)) return false;
      seen.add(parentId);
      parentId = parent.parentId;
    }
    return true;
  });
}

export function mockUserAccess(user: MockUser) {
  const features = mockPackageFeatures(user.tenantId);
  const pages = new Map(mockAvailableMenus(user.tenantId).filter(page => page.type === 'menu').map(page => [page.id, page]));
  const roleIds = new Set([...user.roles.map(role => role.id), ...mockUserGroups.flatMap(group =>
    group.status === 'enabled' && group.memberIds.includes(user.id) ? group.roleIds : [])]);
  const roles = mockRoles.filter(role => roleIds.has(role.id) && role.status === 'enabled');
  const now = mockDateTime();
  const items = [...mockAccessGrants.values()].flatMap(grant => grant.userId === user.id && grant.status !== 'revoked'
    ? grant.items.filter(item => item.status !== 'revoked' && item.startsAt <= now && (!item.expiresAt || item.expiresAt > now))
    : []);
  const ids = [...new Set([
    ...(mockUserPageIds[user.id] ?? []), ...roles.flatMap(role => role.menuIds ?? []),
    ...items.flatMap(item => item.menuId && pages.get(item.menuId)?.permission === item.permissionCode ? [item.menuId] : []),
  ])].filter(id => {
    const page = pages.get(id);
    return page && (!page.permission || mockPermissionAvailable(page.permission, features));
  });
  const codes = [...new Set([
    ...(mockUserPermissionCodes[user.id] ?? []), ...roles.flatMap(role => role.permissionCodes ?? []),
    ...items.flatMap(item => item.menuId == null ? [item.permissionCode] : []),
    ...ids.flatMap(id => pages.get(id)?.permission ?? []),
  ])].filter(code => mockPermissionAvailable(code, features)).sort();
  return { menuIds: ids, permissions: codes };
}

export function mockUserPermissions(user: MockUser): string[] {
  return isMockPlatformAdmin(user) ? ['*'] : mockUserAccess(user).permissions;
}
