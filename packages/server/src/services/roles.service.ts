import { eq, and, like, or, gte, lte } from 'drizzle-orm';
import { mergeWhere, escapeLike } from '../lib/where-helpers';
import { db } from '../db';
import { roles, roleMenus, userRoles } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { clearUserPermissionCache } from '../lib/permissions';
import { exportToExcel, formatDateTimeForExcel } from '../lib/excel-export';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { currentUser } from '../lib/context';
import { AppError } from '../lib/errors';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { formatDateTime, parseDateTimeInput } from '../lib/datetime';

export function mapRole(row: typeof roles.$inferSelect, menuIds?: number[]) {
  return {
    ...row,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
    ...(menuIds === undefined ? {} : { menuIds }),
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
  status?: 'active' | 'disabled';
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
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const tc = tenantCondition(roles, user);
  const finalWhere = mergeWhere(where, tc);
  const [total, list] = await Promise.all([
    db.$count(roles, finalWhere),
    db.select().from(roles).where(finalWhere).orderBy(roles.id).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: list.map((r) => mapRole(r)), total, page, pageSize };
}

export async function getRole(id: number) {
  const user = currentUser();
  const role = await db.query.roles.findFirst({
    where: and(eq(roles.id, id), tenantCondition(roles, user)),
    with: { roleMenus: { columns: { menuId: true } } },
  });
  if (!role) throw new AppError('角色不存在', 404);
  const menuIds = role.roleMenus.map(({ menuId }) => menuId);
  return mapRole(role, menuIds);
}

export interface CreateRoleInput {
  name: string;
  code: string;
  description?: string;
  status?: 'active' | 'disabled';
  sort?: number;
  dataScope?: 'all' | 'dept' | 'self';
  deptIds?: number[] | null;
}

export async function createRole(data: CreateRoleInput) {
  const user = currentUser();
  try {
    const [role] = await db.insert(roles).values({ ...data, tenantId: getCreateTenantId(user) }).returning();
    return mapRole(role);
  } catch (err: unknown) {
    rethrowPgUniqueViolation(err, '角色编码已存在');
  }
}

export async function updateRole(id: number, data: Partial<CreateRoleInput>) {
  const user = currentUser();
  const [role] = await db.update(roles).set({ ...data }).where(and(eq(roles.id, id), tenantCondition(roles, user))).returning();
  if (!role) throw new AppError('角色不存在', 404);
  return mapRole(role);
}

export async function deleteRole(id: number) {
  const user = currentUser();
  const [deleted] = await db.delete(roles).where(and(eq(roles.id, id), tenantCondition(roles, user))).returning();
  if (!deleted) throw new AppError('角色不存在', 404);
}

async function ensureRoleBelongsToTenant(id: number) {
  const user = currentUser();
  const [role] = await db.select({ id: roles.id }).from(roles).where(and(eq(roles.id, id), tenantCondition(roles, user))).limit(1);
  if (!role) throw new AppError('角色不存在', 404);
}

export async function assignRoleMenus(id: number, menuIds: number[]) {
  await ensureRoleBelongsToTenant(id);
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
  if (!role) throw new AppError('角色不存在', 404);
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

export async function exportRoles(): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const user = currentUser();
  const rows = await db.select().from(roles).where(tenantCondition(roles, user));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '角色名称', key: 'name', width: 18 },
      { header: '角色编码', key: 'code', width: 18 },
      { header: '描述', key: 'description', width: 30 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'active' ? '启用' : '禁用') },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, createdAt: formatDateTimeForExcel(r.createdAt) })),
    '角色列表',
  );
  return { buffer, filename: 'roles.xlsx' };
}
