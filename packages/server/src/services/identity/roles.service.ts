import { eq, and, like, or, gte, lte, asc, inArray } from 'drizzle-orm';
import { SUPER_ADMIN_CODE } from '@zenith/shared';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { db } from '../../db';
import type { DbTransaction } from '../../db/types';
import { roles, roleMenus, roleDeptScopes, userRoles, users } from '../../db/schema';
import { clearUserPermissionCache } from '../../lib/permissions';
import { getTenantPackageMenuIdSet } from '../../lib/tenant-package';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { currentUser } from '../../lib/context';
import { forceLogoutAllByUsers } from '../../lib/session-manager';
import { HTTPException } from 'hono/http-exception';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { formatDateTime, parseDateTimeInput } from '../../lib/datetime';

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

// 平台保留角色编码：超管判定按 code + 平台归属执行，禁止任何人通过 API 创建
// 或改名为保留编码，防止租户自建 super_admin 角色完成提权
const RESERVED_ROLE_CODES = new Set<string>([SUPER_ADMIN_CODE]);

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
    if (!existing) throw new HTTPException(404, { message: '角色不存在' });
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
    if (!role) throw new HTTPException(404, { message: '角色不存在' });
    if (deptScopeIds !== undefined && deptScopeIds !== null) {
      await syncRoleDeptScopes(tx, id, deptScopeIds);
    }
    // 角色状态/属性变更影响权限解析结果（禁用角色即时失权），清空权限缓存
    clearUserPermissionCache();
    return mapRole(role, undefined, deptScopeIds ?? undefined);
  });
}

export async function deleteRole(id: number) {
  const user = currentUser();
  const [existing] = await db.select({ code: roles.code, tenantId: roles.tenantId }).from(roles).where(and(eq(roles.id, id), tenantCondition(roles, user))).limit(1);
  if (!existing) throw new HTTPException(404, { message: '角色不存在' });
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
  if (!deleted) throw new HTTPException(404, { message: '角色不存在' });
}

async function ensureRoleBelongsToTenant(id: number): Promise<{ tenantId: number | null; code: string }> {
  const user = currentUser();
  const [role] = await db.select({ id: roles.id, tenantId: roles.tenantId, code: roles.code }).from(roles).where(and(eq(roles.id, id), tenantCondition(roles, user))).limit(1);
  if (!role) throw new HTTPException(404, { message: '角色不存在' });
  return { tenantId: role.tenantId, code: role.code };
}

export async function assignRoleMenus(id: number, menuIds: number[]) {
  const { tenantId: roleTenantId } = await ensureRoleBelongsToTenant(id);
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
  const user = currentUser();
  const roleInfo = await ensureRoleBelongsToTenant(id);
  const uniqueUserIds = Array.from(new Set(userIds));
  // 多租户：被分配用户必须全部落在当前操作者可见租户内，防止跨租户 IDOR
  if (uniqueUserIds.length > 0) {
    const tc = tenantCondition(users, user);
    const rows = await db.select({ id: users.id }).from(users)
      .where(tc ? and(inArray(users.id, uniqueUserIds), tc) : inArray(users.id, uniqueUserIds));
    if (rows.length !== uniqueUserIds.length) throw new HTTPException(400, { message: '存在无效用户' });
  }
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
  clearUserPermissionCache();
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
