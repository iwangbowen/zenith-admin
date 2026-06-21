import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { getTenantPackageMenuIdSet } from './tenant-package';

const SUPER_ADMIN_CODE = 'super_admin';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  permissions: string[];
  menuIds: number[];
  timestamp: number;
}

const cache = new Map<number, CacheEntry>();

export function isSuperAdmin(roles: string[]): boolean {
  return roles.includes(SUPER_ADMIN_CODE);
}

export async function getUserPermissions(userId: number): Promise<string[]> {
  const entry = cache.get(userId);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.permissions;
  }

  const { permissions, menuIds } = await fetchUserPermissionData(userId);
  cache.set(userId, { permissions, menuIds, timestamp: Date.now() });
  return permissions;
}

export async function getUserMenuIds(userId: number): Promise<number[]> {
  const entry = cache.get(userId);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.menuIds;
  }

  const { permissions, menuIds } = await fetchUserPermissionData(userId);
  cache.set(userId, { permissions, menuIds, timestamp: Date.now() });
  return menuIds;
}

async function fetchUserPermissionData(userId: number): Promise<{ permissions: string[]; menuIds: number[] }> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { tenantId: true },
    with: {
      userRoles: {
        columns: {},
        with: {
          role: {
            columns: {},
            with: {
              roleMenus: {
                columns: {},
                with: {
                  menu: {
                    columns: {
                      id: true,
                      permission: true,
                      visible: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      userMenus: {
        columns: {},
        with: {
          menu: {
            columns: {
              id: true,
              permission: true,
              visible: true,
            },
          },
        },
      },
    },
  });

  if (!user) {
    return { permissions: [], menuIds: [] };
  }

  const roleMenuRows = user.userRoles.flatMap(({ role }) => role.roleMenus.map(({ menu }) => menu));
  const directMenuRows = user.userMenus.map(({ menu }) => menu);
  let allMenuRows = [...roleMenuRows, ...directMenuRows];

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

export function clearUserPermissionCache(userId?: number): void {
  if (userId === undefined) {
    cache.clear();
  } else {
    cache.delete(userId);
  }
}
