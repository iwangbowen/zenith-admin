import { eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { userRoles, roleMenus, menus } from '../db/schema';

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
  // Get role IDs for this user
  const userRoleRows = await db
    .select({ roleId: userRoles.roleId })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));

  const roleIds = userRoleRows.map((r) => r.roleId);
  if (roleIds.length === 0) {
    return { permissions: [], menuIds: [] };
  }

  // Get menu IDs for these roles
  const roleMenuRows = await db
    .select({ menuId: roleMenus.menuId })
    .from(roleMenus)
    .where(inArray(roleMenus.roleId, roleIds));

  const menuIds = [...new Set(roleMenuRows.map((r) => r.menuId))];
  if (menuIds.length === 0) {
    return { permissions: [], menuIds: [] };
  }

  // Get permission codes from these menus
  const menuRows = await db
    .select({ id: menus.id, permission: menus.permission })
    .from(menus)
    .where(inArray(menus.id, menuIds));

  const permissions = [
    ...new Set(
      menuRows
        .map((m) => m.permission)
        .filter((p): p is string => p !== null && p !== '')
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
