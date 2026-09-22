import { eq } from 'drizzle-orm';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DbExecutor } from '../db/types';
import { SUPER_ADMIN_CODE } from '@zenith/shared/identity';
import { db } from '../db';
import { users } from '../db/schema';
import { getTenantPackageFeatureSet } from './tenant-package';
import { enabledGroupRolesWith, extractEnabledGroupRoles } from './user-group-access';
import { config } from '../config';
import redis from './redis';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_TTL_SECONDS = 300;
/** Redis key：{prefix}perm:{userId}，与 session/blacklist 同一命名空间 */
const PERM_CACHE_PREFIX = `${config.redis.keyPrefix}perm:`;

interface CacheEntry {
  permissions: string[];
  menuIds: number[];
  timestamp: number;
}

// 进程内缓存：仅作为 Redis 不可用时的降级数据源（单实例语义）。
// 主存储为 Redis，保证多实例部署下 clearUserPermissionCache 撤权即时生效。
const localCache = new Map<number, CacheEntry>();
const freshPermissionStore = new AsyncLocalStorage<{ userId: number; permissions: string[] }>();

/** Background delivery guards must not reuse a permissions snapshot taken before revocation. */
export async function runWithFreshUserPermissions<T>(userId: number, work: () => Promise<T>, executor: DbExecutor = db): Promise<T> {
  const { permissions } = await fetchUserPermissionData(userId, executor, true);
  return freshPermissionStore.run({ userId, permissions }, work);
}

async function readCacheEntry(userId: number): Promise<CacheEntry | null> {
  try {
    const raw = await redis.get(`${PERM_CACHE_PREFIX}${userId}`);
    return raw ? (JSON.parse(raw) as CacheEntry) : null;
  } catch {
    const entry = localCache.get(userId);
    return entry && Date.now() - entry.timestamp < CACHE_TTL ? entry : null;
  }
}

async function writeCacheEntry(userId: number, entry: CacheEntry): Promise<void> {
  localCache.set(userId, entry);
  try {
    await redis.set(`${PERM_CACHE_PREFIX}${userId}`, JSON.stringify(entry), 'EX', CACHE_TTL_SECONDS);
  } catch {
    // Redis 不可用时退化为进程内缓存
  }
}

async function clearRedisPermCache(userId?: number): Promise<void> {
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
  const entry = await readCacheEntry(userId);
  if (entry) return entry.permissions;

  const { permissions, menuIds } = await fetchUserPermissionData(userId);
  await writeCacheEntry(userId, { permissions, menuIds, timestamp: Date.now() });
  return permissions;
}

export async function getUserMenuIds(userId: number): Promise<number[]> {
  const entry = await readCacheEntry(userId);
  if (entry) return entry.menuIds;

  const { permissions, menuIds } = await fetchUserPermissionData(userId);
  await writeCacheEntry(userId, { permissions, menuIds, timestamp: Date.now() });
  return menuIds;
}

async function fetchUserPermissionData(userId: number, executor: DbExecutor = db, fresh = false): Promise<{ permissions: string[]; menuIds: number[] }> {
  const menuColumns = { id: true, permission: true, visible: true, status: true, featureKey: true } as const;
  const user = await executor.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { tenantId: true },
    with: {
      userRoles: {
        columns: {},
        with: {
          role: {
            columns: { status: true },
            with: {
              roleMenus: {
                columns: {},
                with: { menu: { columns: menuColumns } },
              },
            },
          },
        },
      },
      userMenus: {
        columns: {},
        with: { menu: { columns: menuColumns } },
      },
      // 用户组绑定的角色：组内成员自动继承（仅启用组的启用角色生效，口径见 user-group-access）
      userGroupMembers: enabledGroupRolesWith({
        columns: { status: true },
        with: {
          roleMenus: {
            columns: {},
            with: { menu: { columns: menuColumns } },
          },
        },
      }),
    },
  });

  if (!user) {
    return { permissions: [], menuIds: [] };
  }

  // 禁用角色不再授权（与用户组 status 过滤同一口径）；禁用菜单在下方统一剔除
  const roleMenuRows = user.userRoles
    .filter(({ role }) => role.status === 'enabled')
    .flatMap(({ role }) => role.roleMenus.map(({ menu }) => menu));
  const directMenuRows = user.userMenus.map(({ menu }) => menu);
  const groupMenuRows = extractEnabledGroupRoles(user.userGroupMembers)
    .roles.flatMap((role) => role.roleMenus.map(({ menu }) => menu));
  let allMenuRows = [...roleMenuRows, ...directMenuRows, ...groupMenuRows]
    .filter((menu) => menu.status === 'enabled');

  // 多租户：按租户套餐的功能集过滤——featureKey 为空的菜单是核心能力永远保留；
  // 有 featureKey 的菜单仅当套餐分配了对应功能时保留（套餐禁用时功能集为空 = fail-closed）。
  const featureSet = await getTenantPackageFeatureSet(user.tenantId, fresh ? executor : undefined);
  if (featureSet) {
    allMenuRows = allMenuRows.filter((menu) => !menu.featureKey || featureSet.has(menu.featureKey));
  }

  const menuIds = [...new Set(allMenuRows.map((menu) => menu.id))];

  const permissions = [
    ...new Set(
      allMenuRows
        .map((menu) => menu.permission)
        .filter((permission): permission is string => permission !== null && permission !== '')
    ),
  ];

  return { permissions, menuIds };
}

/**
 * 清除用户权限缓存（Redis 主存储 + 本地降级缓存）。
 * 等待 Redis 删除完成，确保调用方返回时撤权已生效。
 */
export async function clearUserPermissionCache(userId?: number): Promise<void> {
  if (userId === undefined) {
    localCache.clear();
  } else {
    localCache.delete(userId);
  }
  await clearRedisPermCache(userId).catch(() => {});
}
