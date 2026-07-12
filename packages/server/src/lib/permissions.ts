import { eq } from 'drizzle-orm';
import { SUPER_ADMIN_CODE } from '@zenith/shared';
import { db } from '../db';
import { users } from '../db/schema';
import { getTenantPackageMenuIdSet } from './tenant-package';
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

async function fetchUserPermissionData(userId: number): Promise<{ permissions: string[]; menuIds: number[] }> {
  const menuColumns = { id: true, permission: true, visible: true, status: true } as const;
  const user = await db.query.users.findFirst({
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
      // 用户组绑定的角色：组内成员自动继承（仅启用状态的组生效）
      userGroupMembers: {
        columns: {},
        with: {
          group: {
            columns: { status: true },
            with: {
              groupRoles: {
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
            },
          },
        },
      },
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
  const groupMenuRows = (user.userGroupMembers ?? [])
    .filter(({ group }) => group.status === 'enabled')
    .flatMap(({ group }) =>
      group.groupRoles
        .filter(({ role }) => role.status === 'enabled')
        .flatMap(({ role }) => role.roleMenus.map(({ menu }) => menu)),
    );
  let allMenuRows = [...roleMenuRows, ...directMenuRows, ...groupMenuRows]
    .filter((menu) => menu.status === 'enabled');

  // 多租户：将有效菜单/权限交集到租户套餐白名单内；保留不可见的内置工具菜单（个人中心/消息等），避免锁死。
  const packageMenuIds = await getTenantPackageMenuIdSet(user.tenantId);
  if (packageMenuIds) {
    allMenuRows = allMenuRows.filter((menu) => packageMenuIds.has(menu.id) || !menu.visible);
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
 * 保持同步签名以兼容既有调用点；Redis 删除为 fire-and-forget（mock/实现均在同步段
 * 先行发出 DEL，实际竞态窗口仅为网络往返，撤权关键路径另有会话撤销兜底）。
 */
export function clearUserPermissionCache(userId?: number): void {
  if (userId === undefined) {
    localCache.clear();
  } else {
    localCache.delete(userId);
  }
  void clearRedisPermCache(userId).catch(() => {});
}
