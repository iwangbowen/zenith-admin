import { eq, and, like, or, gte, lte, asc, inArray } from 'drizzle-orm';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import type { DbTransaction } from '../db/types';
import { roles, roleMenus, roleDeptScopes, userRoles, users } from '../db/schema';
import { clearUserPermissionCache } from '../lib/permissions';
import { getTenantPackageMenuIdSet } from '../lib/tenant-package';
import { streamToExcel, streamToCsv, formatDateTimeForExcel } from '../lib/excel-export';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { currentUser } from '../lib/context';
import { HTTPException } from 'hono/http-exception';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { formatDateTime, parseDateTimeInput } from '../lib/datetime';

export function mapRole(row: typeof roles.$inferSelect, menuIds?: number[], deptScopeIds?: number[]) {
  return {
    ...row,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
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

export interface ListRolesQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'enabled' | 'disabled';
  startTime?: string;
  endTime?: string;
}

export async function listRoles(q: ListRolesQuery) {
  const user = currentUser();
  const { page = 1, pageSize = 10 } = q;
  const conditions = [];
  if (q.keyword) conditions.push(or(like(roles.name, `%${escapeLike(q.keyword)}%`), like(roles.code, `%${escapeLike(q.keyword)}%`)));
  if (q.status) conditions.push(eq(roles.status, q.status));
  const startTime = parseDateTimeInput(q.startTime);
  const endTime = parseDateTimeInput(q.endTime);
  if (startTime) conditions.push(gte(roles.createdAt, startTime));
  if (endTime) conditions.push(lte(roles.createdAt, endTime));
  const where = and(...conditions);
  const tc = tenantCondition(roles, user);
  const finalWhere = mergeWhere(where, tc);
  const [total, list] = await Promise.all([
    db.$count(roles, finalWhere),
    withPagination(db.select().from(roles).where(finalWhere).orderBy(roles.id).$dynamic(), page, pageSize),
  ]);

  // Fetch user counts & previews (first 5 per role) for the current page
  const roleIds = list.map((r) => r.id);
  const countMap = new Map<number, number>();
  const previewMap = new Map<number, Array<{ id: number; nickname: string; avatar: string | null }>>();
  if (roleIds.length > 0) {
    const rows = await db
      .select({
        roleId: userRoles.roleId,
        id: users.id,
        nickname: users.nickname,
        avatar: users.avatar,
      })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(inArray(userRoles.roleId, roleIds))
      .orderBy(asc(userRoles.roleId), asc(userRoles.userId));

    for (const row of rows) {
      countMap.set(row.roleId, (countMap.get(row.roleId) ?? 0) + 1);
      if (!previewMap.has(row.roleId)) previewMap.set(row.roleId, []);
      const arr = previewMap.get(row.roleId)!;
      if (arr.length < 5) arr.push({ id: row.id, nickname: row.nickname, avatar: row.avatar ?? null });
    }
  }

  const mappedList = list.map((row) => ({
    ...mapRole(row),
    userCount: countMap.get(row.id) ?? 0,
    userPreview: previewMap.get(row.id) ?? [],
  }));

  return { list: mappedList, total, page, pageSize };
}

export async function getRole(id: number) {
  const user = currentUser();
  const role = await db.query.roles.findFirst({
    where: and(eq(roles.id, id), tenantCondition(roles, user)),
    with: {
      roleMenus: { columns: { menuId: true } },
      deptScopes: { columns: { deptId: true } },
    },
  });
  if (!role) throw new HTTPException(404, { message: '角色不存在' });
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

export async function createRole(data: CreateRoleInput) {
  const user = currentUser();
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
    const [existing] = await tx.select({ code: roles.code }).from(roles).where(and(eq(roles.id, id), tenantCondition(roles, user))).limit(1);
    if (!existing) throw new HTTPException(404, { message: '角色不存在' });
    if (existing.code === 'super_admin' && rest.status === 'disabled') {
      throw new HTTPException(400, { message: '超级管理员角色不允许禁用' });
    }
    const [role] = await tx.update(roles).set({ ...rest }).where(and(eq(roles.id, id), tenantCondition(roles, user))).returning();
    if (!role) throw new HTTPException(404, { message: '角色不存在' });
    if (deptScopeIds !== undefined && deptScopeIds !== null) {
      await syncRoleDeptScopes(tx, id, deptScopeIds);
    }
    return mapRole(role, undefined, deptScopeIds ?? undefined);
  });
}

export async function deleteRole(id: number) {
  const user = currentUser();
  const [existing] = await db.select({ code: roles.code }).from(roles).where(and(eq(roles.id, id), tenantCondition(roles, user))).limit(1);
  if (!existing) throw new HTTPException(404, { message: '角色不存在' });
  if (existing.code === 'super_admin') throw new HTTPException(400, { message: '超级管理员角色不允许删除' });
  const [deleted] = await db.delete(roles).where(and(eq(roles.id, id), tenantCondition(roles, user))).returning();
  if (!deleted) throw new HTTPException(404, { message: '角色不存在' });
}

async function ensureRoleBelongsToTenant(id: number): Promise<number | null> {
  const user = currentUser();
  const [role] = await db.select({ id: roles.id, tenantId: roles.tenantId }).from(roles).where(and(eq(roles.id, id), tenantCondition(roles, user))).limit(1);
  if (!role) throw new HTTPException(404, { message: '角色不存在' });
  return role.tenantId;
}

export async function assignRoleMenus(id: number, menuIds: number[]) {
  const roleTenantId = await ensureRoleBelongsToTenant(id);
  // 多租户：角色所属租户绑定套餐时，分配的菜单必须落在套餐白名单内。
  const packageMenuIds = await getTenantPackageMenuIdSet(roleTenantId);
  if (packageMenuIds && menuIds.some((mid) => !packageMenuIds.has(mid))) {
    throw new HTTPException(400, { message: '所选菜单超出当前租户套餐范围，无法分配' });
  }
  await db.transaction(async (tx) => {
    await tx.delete(roleMenus).where(eq(roleMenus.roleId, id));
    if (menuIds.length > 0) {
      await tx.insert(roleMenus).values(menuIds.map((menuId) => ({ roleId: id, menuId })));
    }
  });
  clearUserPermissionCache();
}

export async function getRoleUsers(id: number) {
  const user = currentUser();
  const role = await db.query.roles.findFirst({
    where: and(eq(roles.id, id), tenantCondition(roles, user)),
    columns: {},
    with: { userRoles: { columns: {}, with: { user: true } } },
  });
  if (!role) throw new HTTPException(404, { message: '角色不存在' });
  return role.userRoles.map(({ user: u }) => ({
    id: u.id, username: u.username, nickname: u.nickname, email: u.email,
    avatar: u.avatar, status: u.status,
    createdAt: formatDateTime(u.createdAt), updatedAt: formatDateTime(u.updatedAt),
  }));
}

export async function assignRoleUsers(id: number, userIds: number[]) {
  await ensureRoleBelongsToTenant(id);
  await db.transaction(async (tx) => {
    await tx.delete(userRoles).where(eq(userRoles.roleId, id));
    if (userIds.length > 0) {
      await tx.insert(userRoles).values(userIds.map((userId) => ({ userId, roleId: id })));
    }
  });
  clearUserPermissionCache();
}

export async function exportRoles(): Promise<{ stream: ReadableStream; filename: string }> {
  const user = currentUser();
  const rows = await db.select().from(roles).where(tenantCondition(roles, user));
  const stream = await streamToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '角色名称', key: 'name', width: 18 },
      { header: '角色编码', key: 'code', width: 18 },
      { header: '描述', key: 'description', width: 30 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'enabled' ? '启用' : '禁用') },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, createdAt: formatDateTimeForExcel(r.createdAt) })),
    '角色列表',
  );
  return { stream, filename: 'roles.xlsx' };
}

export async function exportRolesAsCsv(): Promise<{ stream: ReadableStream; filename: string }> {
  const user = currentUser();
  const rows = await db.select().from(roles).where(tenantCondition(roles, user));
  const stream = streamToCsv(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '角色名称', key: 'name', width: 18 },
      { header: '角色编码', key: 'code', width: 18 },
      { header: '描述', key: 'description', width: 30 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'enabled' ? '启用' : '禁用') },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, createdAt: formatDateTimeForExcel(r.createdAt) })),
  );
  return { stream, filename: 'roles.csv' };
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
