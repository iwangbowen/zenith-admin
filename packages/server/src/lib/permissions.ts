import { eq, inArray } from 'drizzle-orm';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DbExecutor } from '../db/types';
import { SUPER_ADMIN_CODE, type DataScope } from '@zenith/shared/identity';
import { db } from '../db';
import { users, identityAccessGrants, identityAccessGrantItems } from '../db/schema';
import { onInvalidate, onInvalidationReset, invalidationBusState } from './invalidation-bus';
import { broadcast, sendToUser } from './ws-manager';
import { enabledGroupRolesWith } from './user-group-access';
import { availableNavigation, getPageReadCode, isPermissionAvailable, readPageAccessRows } from './page-access';
import { getTenantPackageFeatureSet } from './tenant-package';
import { config } from '../config';
import redis from './redis';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_TTL_SECONDS = 300;
/** Redis key：{prefix}perm:{userId}，与 session/blacklist 同一命名空间 */
const PERM_CACHE_PREFIX = `${config.redis.keyPrefix}perm:access:`;
const PERM_GENERATION_KEY = `${config.redis.keyPrefix}perm-generation`;
let cacheResetRequired = false;

async function readPermissionGeneration(userId: number): Promise<string> {
  const [global, personal] = await Promise.all([redis.get(PERM_GENERATION_KEY), redis.get(`${PERM_GENERATION_KEY}:user:${userId}`)]);
  return `${global ?? '0'}:${personal ?? '0'}`;
}

interface AccessSource {
  kind: 'role' | 'group' | 'direct' | 'approval';
  label: string;
  dataScope: DataScope;
  deptScopeIds: number[];
  permissionCodes: string[];
  explicitPermissionCodes: string[];
  pageReads: Array<{ code: string; title: string }>;
  menuIds: number[];
  grantItem?: { grantId: number; grantItemId: number; expiresAt: string | null };
}

interface EffectiveUserAccess {
  permissions: string[];
  menuIds: number[];
  nextPermissionBoundaryAt: number | null;
  departmentId: number | null;
  userDataScope: DataScope | null;
  userDeptScopeIds: number[];
  superAdmin: boolean;
  sources: AccessSource[];
}

interface CacheEntry extends EffectiveUserAccess {
  timestamp: number;
  generation: string;
}

const emptyAccess: EffectiveUserAccess = {
  permissions: [], menuIds: [], nextPermissionBoundaryAt: null,
  departmentId: null, userDataScope: null, userDeptScopeIds: [], superAdmin: false, sources: [],
};

const freshPermissionStore = new AsyncLocalStorage<{ userId: number; executor: DbExecutor; access: EffectiveUserAccess }>();

/** Background delivery guards must not reuse a permissions snapshot taken before revocation. */
export async function runWithFreshUserPermissions<T>(userId: number, work: () => Promise<T>, executor: DbExecutor = db): Promise<T> {
  const access = await fetchUserPermissionData(userId, executor);
  return freshPermissionStore.run({ userId, executor, access }, work);
}

function isCacheEntryValid(entry: CacheEntry | null | undefined): entry is CacheEntry {
  if (!entry || Date.now() - entry.timestamp >= CACHE_TTL) return false;
  return entry.nextPermissionBoundaryAt === null || Date.now() < entry.nextPermissionBoundaryAt;
}

async function readCacheEntry(userId: number): Promise<CacheEntry | null> {
  if (invalidationBusState() !== 'listening') return null;
  try {
    if (cacheResetRequired) {
      await clearRedisPermCache();
      cacheResetRequired = false;
    }
    const [raw, generation] = await Promise.all([redis.get(`${PERM_CACHE_PREFIX}${userId}`), readPermissionGeneration(userId)]);
    const entry = raw ? JSON.parse(raw) as CacheEntry : null;
    return isCacheEntryValid(entry) && entry.generation === generation ? entry : null;
  } catch {
    cacheResetRequired = true;
    return null;
  }
}

async function loadPermissionData(userId: number) {
  const cached = await readCacheEntry(userId);
  if (cached) return cached;
  // Read the generation before the database so an in-flight old read cannot repopulate a revoked cache.
  const generation = await readPermissionGeneration(userId).catch(() => { cacheResetRequired = true; return null; });
  const data = await fetchUserPermissionData(userId);
  if (!cacheResetRequired && invalidationBusState() === 'listening') {
    await redis.set(`${PERM_CACHE_PREFIX}${userId}`, JSON.stringify({ ...data, timestamp: Date.now(), generation }), 'EX', CACHE_TTL_SECONDS).catch(() => { cacheResetRequired = true; });
  }
  return data;
}

async function clearRedisPermCache(userId?: number): Promise<void> {
  await redis.incr(userId === undefined ? PERM_GENERATION_KEY : `${PERM_GENERATION_KEY}:user:${userId}`);
  if (userId !== undefined) {
    await redis.del(`${PERM_CACHE_PREFIX}${userId}`);
    return;
  }
  // 全量清除：SCAN 按前缀逐批删除，避免 KEYS 阻塞
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${PERM_CACHE_PREFIX}*`, 'COUNT', 200);
    cursor = next;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== '0');
}

/**
 * 平台超管判定：角色 code 含 super_admin **且** 归属平台（tenantId 为 null）。
 * 仅凭 code 判定会被租户自建同名角色伪造（横向/纵向提权），必须双条件校验。
 */
export function isSuperAdmin(user: { roles: string[]; tenantId?: number | null }): boolean {
  return user.roles.includes(SUPER_ADMIN_CODE) && (user.tenantId ?? null) === null;
}

export async function getUserPermissions(userId: number): Promise<string[]> {
  return (await getUserEffectiveAccess(userId)).permissions;
}

export async function getUserMenuIds(userId: number): Promise<number[]> {
  return (await getUserEffectiveAccess(userId)).menuIds;
}

export async function getUserPermissionBoundary(userId: number): Promise<number | null> {
  return (await getUserEffectiveAccess(userId)).nextPermissionBoundaryAt;
}

export async function getUserEffectiveAccess(userId: number, executor?: DbExecutor): Promise<EffectiveUserAccess> {
  const fresh = freshPermissionStore.getStore();
  if (fresh?.userId === userId && (!executor || fresh.executor === executor)) return fresh.access;
  return executor && executor !== db ? fetchUserPermissionData(userId, executor) : loadPermissionData(userId);
}

const roleAccess = {
  columns: { name: true, code: true, tenantId: true, permissionCodes: true, dataScope: true, status: true },
  with: { roleMenus: { columns: { menuId: true } }, deptScopes: { columns: { deptId: true } } },
} as const;

async function fetchUserPermissionData(userId: number, executor: DbExecutor = db): Promise<EffectiveUserAccess> {
  const now = new Date();
  const user = await executor.query.users.findFirst({
    where: eq(users.id, userId), columns: { tenantId: true, status: true, departmentId: true, userDataScope: true },
    with: {
      userRoles: { columns: {}, with: { role: roleAccess } },
      directPermissions: { columns: { permissionCode: true, dataScope: true, deptScopeIds: true } },
      userMenus: { columns: { menuId: true } },
      userDeptScopes: { columns: { deptId: true } },
      userGroupMembers: enabledGroupRolesWith(roleAccess),
      accessGrants: {
        where: inArray(identityAccessGrants.status, ['scheduled', 'active']),
        with: {
          items: { where: inArray(identityAccessGrantItems.status, ['scheduled', 'active']) },
        },
      },
    },
  });
  if (!user || user.status !== 'enabled') return emptyAccess;
  const enabledRoles = user.userRoles.map(binding => binding.role).filter(role => role.status === 'enabled' && role.tenantId === user.tenantId);
  const groupRoles = user.userGroupMembers.filter(({ group }) => group.status === 'enabled').flatMap(({ group }) =>
    group.groupRoles.filter(({ role }) => role.status === 'enabled' && role.tenantId === user.tenantId).map(({ role }) => ({ role, group })));
  const grants = user.accessGrants.filter(grant => grant.tenantId === user.tenantId);
  const hasPages = user.userMenus.length > 0 || enabledRoles.some(role => role.roleMenus.length > 0)
    || groupRoles.some(({ role }) => role.roleMenus.length > 0) || grants.some(grant => grant.items.some(item => item.menuId != null));
  const superAdmin = user.tenantId === null && enabledRoles.some(role => role.code === SUPER_ADMIN_CODE);
  const [features, navigation] = await Promise.all([
    getTenantPackageFeatureSet(user.tenantId, executor === db ? undefined : executor),
    hasPages ? readPageAccessRows(executor) : [],
  ]);
  const pages = new Map(availableNavigation(navigation, features, user.tenantId === null)
    .filter(page => page.type === 'menu').map(page => [page.id, page]));
  const canUse = (code: string) => isPermissionAvailable(code, features);
  const sources: AccessSource[] = [];
  const collect = (kind: AccessSource['kind'], label: string, dataScope: DataScope, deptScopeIds: number[], codes: readonly string[], pageIds: readonly number[], grantItem?: AccessSource['grantItem']) => {
    const explicitPermissionCodes = codes.filter(canUse);
    const permissionCodes = new Set(explicitPermissionCodes);
    const menuIds: number[] = [];
    const pageReads: AccessSource['pageReads'] = [];
    for (const id of pageIds) {
      const page = pages.get(id);
      if (!page) continue;
      const read = getPageReadCode(page);
      if (read && !canUse(read)) continue;
      if (read) {
        permissionCodes.add(read);
        pageReads.push({ code: read, title: page.title });
      }
      menuIds.push(id);
    }
    if (kind === 'role' || kind === 'group' || menuIds.length || permissionCodes.size) {
      sources.push({ kind, label, dataScope, deptScopeIds, explicitPermissionCodes, pageReads, permissionCodes: [...permissionCodes], menuIds, grantItem });
    }
  };
  for (const role of enabledRoles) {
    collect('role', `角色：${role.name}`, role.dataScope, role.deptScopes.map(row => row.deptId), role.permissionCodes, role.roleMenus.map(row => row.menuId));
  }
  for (const { role, group } of groupRoles) {
    collect('group', `角色：${role.name}（用户组：${group.name}）`, role.dataScope, role.deptScopes.map(row => row.deptId), role.permissionCodes, role.roleMenus.map(row => row.menuId));
  }
  collect('direct', '用户直接授权', 'self', [], [], user.userMenus.map(row => row.menuId));
  for (const direct of user.directPermissions) {
    collect('direct', '用户直接授权', direct.dataScope, direct.deptScopeIds, [direct.permissionCode], []);
  }
  const isActive = (window: { startsAt: Date; expiresAt: Date | null }) => window.startsAt <= now && (!window.expiresAt || window.expiresAt > now);
  for (const grant of grants.filter(isActive)) {
    for (const item of grant.items.filter(isActive)) {
      const page = item.menuId == null ? null : pages.get(item.menuId);
      if (item.menuId != null && (!page || getPageReadCode(page) !== item.permissionCode)) continue;
      collect('approval', `审批授权 #${grant.id}`, item.dataScope, item.deptScopeIds,
        page ? [] : [item.permissionCode], page ? [page.id] : [], {
        grantId: grant.id, grantItemId: item.id, expiresAt: item.expiresAt?.toISOString() ?? null,
      });
    }
  }
  const nextPermissionBoundaryAt = grants.flatMap(grant => [grant, ...grant.items])
    .flatMap(item => [item.startsAt, item.expiresAt]).filter((date): date is Date => date !== null && date > now)
    .reduce<number | null>((boundary, date) => boundary === null ? date.getTime() : Math.min(boundary, date.getTime()), null);
  return {
    permissions: [...new Set(sources.flatMap(source => source.permissionCodes))].sort(),
    menuIds: [...new Set(sources.flatMap(source => source.menuIds))],
    nextPermissionBoundaryAt,
    sources,
    departmentId: user.departmentId,
    userDataScope: user.userDataScope,
    userDeptScopeIds: user.userDeptScopes.map(row => row.deptId),
    superAdmin,
  };
}

/**
 * 清除用户权限缓存（Redis 缓存；不可用时直接读取数据库）。
 * 等待 Redis 删除完成，确保调用方返回时撤权已生效。
 */
export async function notifyUserPermissionsChanged(userId: number): Promise<void> {
  await clearUserPermissionCache(userId);
  sendToUser(userId, { type: 'identity:permissions-changed', payload: { userId } });
}

export async function notifyNavigationPermissionsChanged(): Promise<void> {
  await clearUserPermissionCache();
  broadcast({ type: 'identity:permissions-changed', payload: { userId: null } });
}

function invalidateUserEntry(key?: string | null): void {
  const userId = Number(key);
  void clearUserPermissionCache(Number.isSafeInteger(userId) && userId > 0 ? userId : undefined);
}

onInvalidate('identity_access_grants', message => invalidateUserEntry(message.key));
onInvalidate('identity_access_grant_items', message => {
  const grantId = Number(message.key);
  if (Number.isSafeInteger(grantId) && grantId > 0) void db.query.identityAccessGrants.findFirst({ where: eq(identityAccessGrants.id, grantId), columns: { userId: true } })
    .then(grant => { if (grant) invalidateUserEntry(String(grant.userId)); }).catch(() => {});
});
onInvalidate('user_roles', message => invalidateUserEntry(message.key));
onInvalidate('identity_user_permissions', message => invalidateUserEntry(message.key));
onInvalidate('roles', () => invalidateUserEntry());
onInvalidate('users', message => invalidateUserEntry(message.key));
onInvalidate('menus', () => invalidateUserEntry());
onInvalidate('role_menus', () => invalidateUserEntry());
onInvalidate('user_groups', () => invalidateUserEntry());
onInvalidate('tenants', () => invalidateUserEntry());
onInvalidate('tenant_package_features', () => invalidateUserEntry());
onInvalidate('tenant_packages', () => invalidateUserEntry());
onInvalidate('user_group_roles', () => invalidateUserEntry());
onInvalidate('user_menus', message => invalidateUserEntry(message.key));
onInvalidate('user_group_members', message => invalidateUserEntry(message.key));
onInvalidationReset(() => { void clearUserPermissionCache(); });

export async function clearUserPermissionCache(userId?: number): Promise<void> {
  await clearRedisPermCache(userId).catch(() => { cacheResetRequired = true; });
}
