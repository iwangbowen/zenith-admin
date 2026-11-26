/**
 * 接口权限矩阵的数据面：只回答「主体持有哪些权限码」。
 *
 * 「接口需要什么权限」由契约 `access` 在前端直接派生（`@zenith/shared/permission-catalog`），
 * 这里不复制那份知识，也不落任何新表；角色 / 用户的权限码口径与登录态一致：
 * 启用按钮菜单的 permission，经租户套餐功能集过滤（`lib/permissions.ts`）。
 */
import { and, asc, eq } from 'drizzle-orm';
import { SUPER_ADMIN_CODE, type RolePermissionSet, type UserPermissionSet } from '@zenith/shared/identity';
import { db } from '../../db';
import { roles, users } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { getUserPermissions, isSuperAdmin } from '../../lib/permissions';
import { availableNavigation, getPageReadCode, isPermissionAvailable, readPageAccessRows } from '../../lib/page-access';
import { getTenantPackageFeatureSet } from '../../lib/tenant-package';
import { tenantCondition } from '../../lib/tenant';
import { extractEnabledGroupRoles, enabledGroupRolesWith } from '../../lib/user-group-access';

/** 当前租户视角下全部角色各自生效的权限码 */
export async function listRolePermissionSets(): Promise<RolePermissionSet[]> {
  const user = currentUser();
  const rows = await db.query.roles.findMany({
    where: tenantCondition(roles, user),
    orderBy: [asc(roles.id)],
    columns: { id: true, name: true, code: true, status: true, tenantId: true, permissionCodes: true },
    with: { roleMenus: { columns: { menuId: true } } },
  });
  const navigation = await readPageAccessRows(db);
  const byTenant = new Map(await Promise.all([...new Set(rows.map(role => role.tenantId))].map(async tenantId => {
    const features = await getTenantPackageFeatureSet(tenantId);
    const pages = new Map(availableNavigation(navigation, features, tenantId === null).map(page => [page.id, getPageReadCode(page)]));
    return [tenantId, { features, pages }] as const;
  })));
  return rows.map(role => {
    const { features, pages } = byTenant.get(role.tenantId)!;
    const codes = new Set([...role.permissionCodes, ...role.roleMenus.flatMap(page => pages.get(page.menuId) ?? [])]);
    return {
      id: role.id,
      name: role.name,
      code: role.code,
      status: role.status,
      tenantId: role.tenantId,
      superAdmin: role.code === SUPER_ADMIN_CODE && role.tenantId === null,
      permissions: role.status === 'enabled' ? [...codes].filter(code => isPermissionAvailable(code, features)).sort() : [],
    };
  });
}

/** 单个用户生效的权限码：角色 + 直授菜单 + 用户组角色合并（复用登录态同一份解析与缓存） */
export async function getUserPermissionSet(userId: number): Promise<UserPermissionSet> {
  const viewer = currentUser();
  const row = requireRow(await db.query.users.findFirst({
    where: and(eq(users.id, userId), tenantCondition(users, viewer)),
    columns: { id: true, username: true, nickname: true, status: true, tenantId: true },
    with: {
      userRoles: { columns: {}, with: { role: { columns: { id: true, name: true, code: true, status: true } } } },
      userGroupMembers: enabledGroupRolesWith({ columns: { id: true, name: true, code: true, status: true } }),
    },
  }), '用户不存在');
  const directRoles = row.userRoles.map(({ role }) => role).filter((role) => role.status === 'enabled');
  const groupRoles = extractEnabledGroupRoles(row.userGroupMembers).roles;
  const roleList = [...new Map([...directRoles, ...groupRoles].map((role) => [role.id, role])).values()]
    .map(({ id, name, code }) => ({ id, name, code }));
  const superAdmin = isSuperAdmin({ roles: roleList.map((role) => role.code), tenantId: row.tenantId });
  return {
    userId: row.id,
    username: row.username,
    nickname: row.nickname,
    status: row.status,
    tenantId: row.tenantId,
    superAdmin,
    roles: roleList,
    permissions: superAdmin ? [] : [...(await getUserPermissions(row.id))].sort(),
  };
}
