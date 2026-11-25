import { eq, inArray } from 'drizzle-orm';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DbExecutor } from '../db/types';
import { SUPER_ADMIN_CODE } from '@zenith/shared/identity';
import { db } from '../db';
import { users, identityAccessGrants, identityAccessGrantItems } from '../db/schema';
import { onInvalidate, onInvalidationReset, invalidationBusState } from './invalidation-bus';
import { sendToUser } from './ws-manager';
import { availablePermissionCodes } from '../services/identity/permission-catalog.service';
import { enabledGroupRolesWith, extractEnabledGroupRoles } from './user-group-access';
import { config } from '../config';
import redis from './redis';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_TTL_SECONDS = 300;
/** Redis key：{prefix}perm:{userId}，与 session/blacklist 同一命名空间 */
const PERM_CACHE_PREFIX = `${config.redis.keyPrefix}perm:`;
const PERM_GENERATION_KEY = `${config.redis.keyPrefix}perm-generation`;
let cacheResetRequired = false;

async function readPermissionGeneration(userId: number): Promise<string> {
  const [global, personal] = await Promise.all([redis.get(PERM_GENERATION_KEY), redis.get(`${PERM_GENERATION_KEY}:user:${userId}`)]);
  return `${global ?? '0'}:${personal ?? '0'}`;
}

interface CacheEntry {
  permissions: string[];
  menuIds: number[];
  timestamp: number;
  generation: string;
  /** 下一个临时授权时间边界；到达后不能继续使用旧缓存 */
  nextPermissionBoundaryAt: number | null;
}

const freshPermissionStore = new AsyncLocalStorage<{ userId: number; permissions: string[] }>();

/** Background delivery guards must not reuse a permissions snapshot taken before revocation. */
export async function runWithFreshUserPermissions<T>(userId: number, work: () => Promise<T>, executor: DbExecutor = db): Promise<T> {
  const { permissions } = await fetchUserPermissionData(userId, executor, true);
  return freshPermissionStore.run({ userId, permissions }, work);
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
  const fresh = freshPermissionStore.getStore();
  if (fresh?.userId === userId) return fresh.permissions;
  return (await loadPermissionData(userId)).permissions;
}

export async function getUserMenuIds(userId: number): Promise<number[]> {
  return (await loadPermissionData(userId)).menuIds;
}

export async function getUserPermissionBoundary(userId: number): Promise<number | null> {
  return (await loadPermissionData(userId)).nextPermissionBoundaryAt;
}

async function fetchUserPermissionData(userId: number, executor: DbExecutor = db, _fresh = false): Promise<{ permissions: string[]; menuIds: number[]; nextPermissionBoundaryAt: number | null }> {
  const now = new Date();
  const user = await executor.query.users.findFirst({
    where: eq(users.id, userId), columns: { tenantId: true, status: true },
    with: {
      userRoles: { with: { role: { columns: { permissionCodes: true, status: true }, with: { roleMenus: { with: { menu: { columns: { id: true, permission: true, status: true, type: true } } } } } } } },
      directPermissions: { columns: { permissionCode: true } },
      userMenus: { with: { menu: { columns: { id: true, permission: true, status: true, type: true } } } },
      userGroupMembers: enabledGroupRolesWith({
        columns: { permissionCodes: true, status: true },
        with: { roleMenus: { with: { menu: { columns: { id: true, permission: true, status: true, type: true } } } } },
      }),
      accessGrants: {
        where: inArray(identityAccessGrants.status, ['scheduled', 'active']),
        with: {
          items: { where: inArray(identityAccessGrantItems.status, ['scheduled', 'active']) },
          menus: { with: { menu: { columns: { id: true, permission: true, status: true, type: true } } } },
        },
      },
    },
  });
  if (!user || user.status !== 'enabled') return { permissions: [], menuIds: [], nextPermissionBoundaryAt: null };
  const granted = user.accessGrants.flatMap(grant => grant.items);
  const active = granted.filter(item => item.startsAt <= now && (!item.expiresAt || item.expiresAt > now));
  const nextPermissionBoundaryAt = granted.flatMap(item => [item.startsAt, item.expiresAt]).filter((date): date is Date => date !== null && date > now)
    .reduce<number | null>((boundary, date) => boundary === null ? date.getTime() : Math.min(boundary, date.getTime()), null);
  const activeGrantMenus = user.accessGrants
    .filter(grant => grant.status === 'active' && grant.startsAt <= now && (!grant.expiresAt || grant.expiresAt > now))
    .flatMap(grant => grant.menus);
  const groupRoles = extractEnabledGroupRoles(user.userGroupMembers).roles;
  const roleMenus = user.userRoles.filter(({ role }) => role.status === 'enabled').flatMap(({ role }) => role.roleMenus);
  const groupRoleMenus = groupRoles.flatMap(role => role.roleMenus ?? []);
  const navigationBindings = [...user.userMenus, ...roleMenus, ...groupRoleMenus, ...activeGrantMenus]
    .filter(({ menu }) => menu.status === 'enabled');
  const pageReadCodes = navigationBindings
    .map(({ menu }) => menu.permission)
    .filter((code): code is string => typeof code === 'string' && code.length > 0);
  const codes = [
    ...user.userRoles.filter(({ role }) => role.status === 'enabled').flatMap(({ role }) => role.permissionCodes),
    ...groupRoles.flatMap(role => role.permissionCodes),
    ...pageReadCodes,
    ...user.directPermissions.map(item => item.permissionCode), ...active.map(item => item.permissionCode),
  ];
  const permissions = await availablePermissionCodes(codes, user.tenantId, executor);
  const permissionSet = new Set(permissions);
  const explicitMenus = navigationBindings
    .filter(({ menu }) => !menu.permission || permissionSet.has(menu.permission))
    .map(({ menu }) => menu.id);
  return { permissions, menuIds: [...new Set(explicitMenus)], nextPermissionBoundaryAt };
}

/**
 * 清除用户权限缓存（Redis 缓存；不可用时直接读取数据库）。
 * 等待 Redis 删除完成，确保调用方返回时撤权已生效。
 */
export async function notifyUserPermissionsChanged(userId: number): Promise<void> {
  await clearUserPermissionCache(userId);
  sendToUser(userId, { type: 'identity:permissions-changed', payload: { userId } });
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
onInvalidate('identity_access_grant_menus', message => {
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
