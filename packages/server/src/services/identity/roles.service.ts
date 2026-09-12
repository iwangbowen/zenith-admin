import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { eq, and, inArray } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import { roleContract, SUPER_ADMIN_CODE } from '@zenith/shared/identity';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { db } from '../../db';
import type { DbTransaction } from '../../db/types';
import { roles, roleMenus, roleDeptScopes, userRoles, menus } from '../../db/schema';
import { clearUserPermissionCache } from '../../lib/permissions';
import { getTenantPackageFeatureSet } from '../../lib/tenant-package';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { currentUser } from '../../lib/context';
import { forceLogoutAllByUsers } from '../../lib/session-manager';
import { HTTPException } from 'hono/http-exception';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { formatDateTime, formatTimestamps } from '../../lib/datetime';
import { getScopeMemberSummaries, validateScopeUserIds } from './user-scope.service';
import { RESERVED_ROLE_CODES } from './role-grant';

export function mapRole(row: typeof roles.$inferSelect, menuIds?: number[], deptScopeIds?: number[]) {
  return {
    ...row,
    ...formatTimestamps(row),
    ...(menuIds === undefined ? {} : { menuIds }),
    ...(deptScopeIds === undefined ? {} : { deptScopeIds }),
  };
}

export async function listAllRoles() {
  const user = currentUser();
  const tc = tenantCondition(roles, user);
  const list = await db.select().from(roles).where(tc).orderBy(roles.id);
  return list.map((r) => mapRole(r));
}

export async function listRoles(q: QueryOutputOf<typeof roleContract.list>) {
  const user = currentUser();
  const { page, pageSize } = q;
  const finalWhere = buildWhere(
    keywordCondition(q.keyword, [roles.name, roles.code]),
    q.status ? eq(roles.status, q.status) : undefined,
    ...dateRangeConditions(roles.createdAt, q.startTime, q.endTime),
    tenantCondition(roles, user),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(roles, finalWhere),
    rows: async () => {
      const list = await withPagination(db.select().from(roles).where(finalWhere).orderBy(roles.id).$dynamic(), page, pageSize);
      const memberSummaries = await getScopeMemberSummaries('role', list.map((row) => row.id));
      return list.map((row) => ({
        ...mapRole(row),
        userCount: memberSummaries.get(row.id)?.count ?? 0,
        userPreview: memberSummaries.get(row.id)?.preview ?? [],
      }));
    },
  });
}

export async function getRole(id: number) {
  const user = currentUser();
  const role = requireRow(await db.query.roles.findFirst({
    where: and(eq(roles.id, id), tenantCondition(roles, user)),
    with: {
      roleMenus: { columns: { menuId: true } },
      deptScopes: { columns: { deptId: true } },
    },
  }), '角色不存在');
  const menuIds = role.roleMenus.map(({ menuId }) => menuId);
  const deptScopeIds = role.deptScopes.map(({ deptId }) => deptId);
  return mapRole(role, menuIds, deptScopeIds);
}

export interface CreateRoleInput {
  name: string;
  code: string;
  description?: string;
  status?: 'enabled' | 'disabled';
  sort?: number;
  dataScope?: 'all' | 'custom' | 'dept_only' | 'dept' | 'self';
  deptIds?: number[] | null;
  deptScopeIds?: number[] | null;
}

async function syncRoleDeptScopes(tx: DbTransaction, roleId: number, deptScopeIds: number[]) {
  await tx.delete(roleDeptScopes).where(eq(roleDeptScopes.roleId, roleId));
  if (deptScopeIds.length > 0) {
    await tx.insert(roleDeptScopes).values(deptScopeIds.map((deptId) => ({ roleId, deptId })));
  }
}

// 平台保留角色编码（定义见 role-grant.ts）：超管判定按 code + 平台归属执行，禁止任何人通过 API 创建
// 或改名为保留编码，防止租户自建 super_admin 角色完成提权
function ensureRoleCodeNotReserved(code: string | undefined) {
  if (code && RESERVED_ROLE_CODES.has(code)) {
    throw new HTTPException(400, { message: `角色编码 ${code} 为系统保留编码，不允许使用` });
  }
}

export async function createRole(data: CreateRoleInput) {
  const user = currentUser();
  ensureRoleCodeNotReserved(data.code);
  const { deptScopeIds, ...rest } = data;
  try {
    return await db.transaction(async (tx) => {
      const [role] = await tx.insert(roles).values({ ...rest, tenantId: getCreateTenantId(user) }).returning();
      if (deptScopeIds !== undefined && deptScopeIds !== null) {
        await syncRoleDeptScopes(tx, role.id, deptScopeIds);
      }
      return mapRole(role, undefined, deptScopeIds ?? undefined);
    });
  } catch (err: unknown) {
    rethrowPgUniqueViolation(err, '角色编码已存在');
  }
}

export async function updateRole(id: number, data: Partial<CreateRoleInput>) {
  const user = currentUser();
  const { deptScopeIds, ...rest } = data;
  return await db.transaction(async (tx) => {
    const [existing] = await tx.select({ code: roles.code, tenantId: roles.tenantId }).from(roles).where(and(eq(roles.id, id), tenantCondition(roles, user))).limit(1);
    requireRow(existing, '角色不存在');
    // 保护仅针对平台超管角色（tenantId=null）；租户遗留的同名伪造角色允许禁用/清理
    const isPlatformSuperRole = existing.code === SUPER_ADMIN_CODE && existing.tenantId === null;
    if (isPlatformSuperRole && rest.status === 'disabled') {
      throw new HTTPException(400, { message: '超级管理员角色不允许禁用' });
    }
    if (rest.code !== undefined && rest.code !== existing.code) {
      // 禁止把普通角色改名为保留编码（伪造超管），也禁止修改超管角色的编码（丢失系统标识）
      ensureRoleCodeNotReserved(rest.code);
      if (isPlatformSuperRole) {
        throw new HTTPException(400, { message: '超级管理员角色编码不允许修改' });
      }
    }
    const [role] = await tx.update(roles).set({ ...rest }).where(and(eq(roles.id, id), tenantCondition(roles, user))).returning();
    requireRow(role, '角色不存在');
    if (deptScopeIds !== undefined && deptScopeIds !== null) {
      await syncRoleDeptScopes(tx, id, deptScopeIds);
    }
    // 角色状态/属性变更影响权限解析结果（禁用角色即时失权），清空权限缓存
    await clearUserPermissionCache();
    return mapRole(role, undefined, deptScopeIds ?? undefined);
  });
}

export async function deleteRole(id: number) {
  const user = currentUser();
  const [existing] = await db.select({ code: roles.code, tenantId: roles.tenantId }).from(roles).where(and(eq(roles.id, id), tenantCondition(roles, user))).limit(1);
  requireRow(existing, '角色不存在');
  // 保护仅针对平台超管角色（tenantId=null）；租户遗留的同名伪造角色允许清理
  if (existing.code === SUPER_ADMIN_CODE && existing.tenantId === null) {
    throw new HTTPException(400, { message: '超级管理员角色不允许删除' });
  }
  // 在用保护：已分配给用户的角色不允许删除，避免级联删除导致用户静默失权
  const boundUsers = await db.$count(userRoles, eq(userRoles.roleId, id));
  if (boundUsers > 0) {
    throw new HTTPException(409, { message: `该角色已分配给 ${boundUsers} 个用户，请先解除用户关联后再删除` });
  }
  const [deleted] = await db.delete(roles).where(and(eq(roles.id, id), tenantCondition(roles, user))).returning();
  requireRow(deleted, '角色不存在');
}

async function ensureRoleBelongsToTenant(id: number): Promise<{ tenantId: number | null; code: string }> {
  const user = currentUser();
  const [role] = await db.select({ id: roles.id, tenantId: roles.tenantId, code: roles.code }).from(roles).where(and(eq(roles.id, id), tenantCondition(roles, user))).limit(1);
  requireRow(role, '角色不存在');
  return { tenantId: role.tenantId, code: role.code };
}

export async function assignRoleMenus(id: number, menuIds: number[]) {
  const { tenantId: roleTenantId } = await ensureRoleBelongsToTenant(id);
  // 多租户：角色所属租户绑定套餐时，分配的菜单必须落在套餐功能范围内。
  const featureSet = await getTenantPackageFeatureSet(roleTenantId);
  if (featureSet && menuIds.length > 0) {
    const rows = await db.select({ featureKey: menus.featureKey }).from(menus).where(inArray(menus.id, menuIds));
    if (rows.some((m) => m.featureKey && !featureSet.has(m.featureKey))) {
      throw new HTTPException(400, { message: '所选菜单超出当前租户套餐功能范围，无法分配' });
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(roleMenus).where(eq(roleMenus.roleId, id));
    if (menuIds.length > 0) {
      await tx.insert(roleMenus).values(menuIds.map((menuId) => ({ roleId: id, menuId })));
    }
  });
  await clearUserPermissionCache();
}

export async function getRoleUsers(id: number) {
  const user = currentUser();
  const role = requireRow(await db.query.roles.findFirst({
    where: and(eq(roles.id, id), tenantCondition(roles, user)),
    columns: {},
    with: { userRoles: { columns: {}, with: { user: true } } },
  }), '角色不存在');
  return role.userRoles.map(({ user: u }) => ({
    id: u.id, username: u.username, nickname: u.nickname, email: u.email,
    avatar: u.avatar, status: u.status,
    createdAt: formatDateTime(u.createdAt), updatedAt: formatDateTime(u.updatedAt),
  }));
}

export async function assignRoleUsers(id: number, userIds: number[]) {
  const roleInfo = await ensureRoleBelongsToTenant(id);
  const uniqueUserIds = await validateScopeUserIds(userIds, roleInfo.tenantId);
  // 平台超管角色：JWT 中的 roles 在 2h 内不随 DB 变化，被移出者须立即撤销会话防权限残留
  const isPlatformSuperRole = roleInfo.code === SUPER_ADMIN_CODE && roleInfo.tenantId === null;
  const removedUserIds: number[] = [];
  if (isPlatformSuperRole) {
    const beforeRows = await db.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, id));
    const nextSet = new Set(uniqueUserIds);
    removedUserIds.push(...beforeRows.map((r) => r.userId).filter((uid) => !nextSet.has(uid)));
  }
  await db.transaction(async (tx) => {
    await tx.delete(userRoles).where(eq(userRoles.roleId, id));
    if (uniqueUserIds.length > 0) {
      await tx.insert(userRoles).values(uniqueUserIds.map((userId) => ({ userId, roleId: id })));
    }
  });
  await clearUserPermissionCache();
  if (removedUserIds.length > 0) {
    try {
      await forceLogoutAllByUsers(removedUserIds);
    } catch {
      // 会话撤销 best-effort，失败不影响主流程
    }
  }
}

export async function getRoleBeforeAudit(id: number) {
  const user = currentUser();
  const role = await db.query.roles.findFirst({
    where: and(eq(roles.id, id), tenantCondition(roles, user)),
    with: {
      roleMenus: { columns: { menuId: true } },
      deptScopes: { columns: { deptId: true } },
      userRoles: { columns: { userId: true } },
    },
  });
  if (!role) return null;
  return {
    ...mapRole(role, role.roleMenus.map(({ menuId }) => menuId), role.deptScopes.map(({ deptId }) => deptId)),
    userIds: role.userRoles.map(({ userId }) => userId),
  };
}
