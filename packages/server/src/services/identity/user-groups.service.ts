import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { db } from '../../db';
import { userGroups, userGroupMembers, userGroupRoles, users, departments, roles } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import type { UserGroupMemberMode, UserGroupMemberRule, userGroupContract } from '@zenith/shared/identity';
import { validateUserGroupRulePresence } from '@zenith/shared/identity';
import type { QueryOutputOf } from '@zenith/shared/core';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { clearUserPermissionCache } from '../../lib/permissions';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { formatDateTime, formatTimestamps } from '../../lib/datetime';
import { getScopeMemberSummaries, validateScopeUserIds } from './user-scope.service';
import { previewDynamicGroupRule, syncDynamicGroup, type RulePreviewResult } from './user-group-rules.service';

interface RawGroupRow {
  id: number;
  name: string;
  code: string;
  description: string | null;
  ownerId: number | null;
  ownerName: string | null;
  memberMode: string;
  memberRule: UserGroupMemberRule | null;
  ruleSyncedAt: Date | null;
  status: 'enabled' | 'disabled';
  memberCount: number;
  roleCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function mapGroup(row: RawGroupRow) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    memberMode: row.memberMode as UserGroupMemberMode,
    memberRule: row.memberRule ?? null,
    ruleSyncedAt: row.ruleSyncedAt ? formatDateTime(row.ruleSyncedAt) : null,
    memberCount: row.memberCount ?? 0,
    roleCount: row.roleCount ?? 0,
    status: row.status,
    ...formatTimestamps(row),
  };
}

const memberCountSql = sql<number>`(SELECT COUNT(*)::int FROM ${userGroupMembers} WHERE ${userGroupMembers.groupId} = ${userGroups.id})`;

const roleCountSql = sql<number>`(SELECT COUNT(*)::int FROM ${userGroupRoles} WHERE ${userGroupRoles.groupId} = ${userGroups.id})`;

function baseSelect() {
  return db
    .select({
      id: userGroups.id,
      name: userGroups.name,
      code: userGroups.code,
      description: userGroups.description,
      ownerId: userGroups.ownerId,
      ownerName: users.nickname,
      memberMode: userGroups.memberMode,
      memberRule: userGroups.memberRule,
      ruleSyncedAt: userGroups.ruleSyncedAt,
      status: userGroups.status,
      memberCount: memberCountSql,
      roleCount: roleCountSql,
      createdAt: userGroups.createdAt,
      updatedAt: userGroups.updatedAt,
    })
    .from(userGroups)
    .leftJoin(users, eq(users.id, userGroups.ownerId));
}

export interface CreateUserGroupInput {
  name: string;
  code: string;
  description?: string;
  ownerId?: number | null;
  status?: 'enabled' | 'disabled';
  memberMode?: UserGroupMemberMode;
  memberRule?: UserGroupMemberRule | null;
}
export type UpdateUserGroupInput = Partial<CreateUserGroupInput>;

export async function listAllUserGroups() {
  const tc = tenantCondition(userGroups, currentUser());
  const rows = await baseSelect().where(tc).orderBy(asc(userGroups.id));
  return rows.map(mapGroup);
}

export async function listUserGroups(q: QueryOutputOf<typeof userGroupContract.list>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    keywordCondition(q.keyword, [userGroups.name, userGroups.code]),
    q.status ? eq(userGroups.status, q.status) : undefined,
  );
  const tc = tenantCondition(userGroups, currentUser());
  const finalWhere = buildWhere(where, tc);

  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(userGroups, finalWhere),
    rows: async () => {
      const list = await withPagination(
        baseSelect().where(finalWhere).orderBy(desc(userGroups.createdAt)).$dynamic(),
        page, pageSize,
      );
      const memberSummaries = await getScopeMemberSummaries('userGroup', list.map((row) => row.id));
      return list.map((row) => ({
        ...mapGroup(row),
        memberPreview: memberSummaries.get(row.id)?.preview ?? [],
      }));
    },
  });
}

export async function getUserGroup(id: number) {
  const tc = tenantCondition(userGroups, currentUser());
  const [row] = await baseSelect().where(and(eq(userGroups.id, id), tc)).limit(1);
  return mapGroup(requireRow(row, '用户组不存在'));
}

export async function createUserGroup(input: CreateUserGroupInput) {
  const memberMode = input.memberMode ?? 'static';
  if (!validateUserGroupRulePresence(memberMode, input.memberRule)) {
    throw new HTTPException(400, { message: '动态用户组至少需要一个部门/岗位条件或强制包含名单' });
  }
  try {
    const [row] = await db
      .insert(userGroups)
      .values({
        ...input,
        memberMode,
        memberRule: memberMode === 'dynamic' ? input.memberRule ?? null : null,
        tenantId: getCreateTenantId(currentUser()),
      })
      .returning();
    // 动态组建组即物化一次成员
    if (row.memberMode === 'dynamic') await syncDynamicGroup(row.id);
    return getUserGroup(row.id);
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    rethrowPgUniqueViolation(err, '用户组编码已存在');
  }
}

export async function updateUserGroup(id: number, input: UpdateUserGroupInput) {
  const tc = tenantCondition(userGroups, currentUser());
  const [existing] = await db
    .select({ id: userGroups.id, memberMode: userGroups.memberMode, memberRule: userGroups.memberRule })
    .from(userGroups)
    .where(and(eq(userGroups.id, id), tc))
    .limit(1);
  requireRow(existing, '用户组不存在');

  // 合并态校验：partial 更新下 mode 与 rule 可能只来其一
  const nextMode = (input.memberMode ?? existing.memberMode) as UserGroupMemberMode;
  const nextRule = input.memberRule !== undefined ? input.memberRule : existing.memberRule;
  if (!validateUserGroupRulePresence(nextMode, nextRule)) {
    throw new HTTPException(400, { message: '动态用户组至少需要一个部门/岗位条件或强制包含名单' });
  }

  try {
    const [row] = await db
      .update(userGroups)
      .set({
        ...input,
        // dynamic → static：冻结当前成员为手工维护，规则清空
        ...(nextMode === 'static' ? { memberRule: null } : {}),
      })
      .where(and(eq(userGroups.id, id), tc))
      .returning();
    requireRow(row, '用户组不存在');

    const ruleChanged = input.memberRule !== undefined || input.memberMode !== undefined;
    if (nextMode === 'dynamic' && ruleChanged) {
      // static → dynamic 或规则变化：成员整体重算（含清缓存）
      await syncDynamicGroup(id);
    } else if (input.status !== undefined) {
      // 组状态切换影响成员继承权限的生效性，清成员缓存即时生效
      const members = await db.select({ userId: userGroupMembers.userId }).from(userGroupMembers).where(eq(userGroupMembers.groupId, id));
      await Promise.all(members.map((m) => clearUserPermissionCache(m.userId)));
    }
    return getUserGroup(row.id);
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    rethrowPgUniqueViolation(err, '用户组编码已存在');
  }
}

export async function deleteUserGroup(id: number): Promise<void> {
  const tc = tenantCondition(userGroups, currentUser());
  const [grp] = await db
    .select({ id: userGroups.id, memberMode: userGroups.memberMode })
    .from(userGroups)
    .where(and(eq(userGroups.id, id), tc))
    .limit(1);
  requireRow(grp, '用户组不存在');
  const members = await db.select({ userId: userGroupMembers.userId }).from(userGroupMembers).where(eq(userGroupMembers.groupId, id));
  // 在用保护仅针对静态组：动态组成员是规则物化产物（成员接口只读，无法手工清空），允许直接删除
  if (grp.memberMode === 'static' && members.length > 0) {
    throw new HTTPException(409, { message: `该用户组下仍有 ${members.length} 名成员，请先移除成员后再删除` });
  }
  await db.delete(userGroups).where(and(eq(userGroups.id, id), tc));
  // 组可能绑定角色：删除即撤销成员的继承权限
  await Promise.all(members.map((m) => clearUserPermissionCache(m.userId)));
}

export async function batchDeleteUserGroups(ids: number[]): Promise<{ count: number }> {
  if (!Array.isArray(ids) || ids.length === 0) throw new HTTPException(400, { message: '请选择要删除的用户组' });
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) throw new HTTPException(400, { message: '用户组ID格式无效' });
  const tc = tenantCondition(userGroups, currentUser());
  // 在用保护仅针对静态组：任一选中静态组仍有成员时整体拒绝，并列出组名
  const blocked = await db
    .selectDistinct({ id: userGroups.id, name: userGroups.name })
    .from(userGroups)
    .innerJoin(userGroupMembers, eq(userGroupMembers.groupId, userGroups.id))
    .where(and(inArray(userGroups.id, validIds), eq(userGroups.memberMode, 'static'), tc));
  if (blocked.length > 0) {
    const names = blocked.slice(0, 3).map((g) => `「${g.name}」`).join('、');
    const suffix = blocked.length > 3 ? ` 等 ${blocked.length} 个用户组` : '';
    throw new HTTPException(409, { message: `${names}${suffix}仍有成员，请先移除成员后再删除` });
  }
  const members = await db
    .select({ userId: userGroupMembers.userId })
    .from(userGroupMembers)
    .where(inArray(userGroupMembers.groupId, validIds));
  await db.delete(userGroups).where(and(inArray(userGroups.id, validIds), tc));
  await Promise.all([...new Set(members.map((m) => m.userId))].map((uid) => clearUserPermissionCache(uid)));
  return { count: validIds.length };
}

export async function getUserGroupBeforeAudit(id: number) {
  const tc = tenantCondition(userGroups, currentUser());
  const [row] = await baseSelect().where(and(eq(userGroups.id, id), tc)).limit(1);
  return row ? mapGroup(row) : null;
}

export async function getUserGroupsBeforeAudit(ids: number[]) {
  const valid = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (valid.length === 0) return [];
  const tc = tenantCondition(userGroups, currentUser());
  const rows = await baseSelect().where(and(inArray(userGroups.id, valid), tc));
  return rows.map(mapGroup);
}

export async function getUserGroupMembersBeforeAudit(groupId: number) {
  const group = await getUserGroupBeforeAudit(groupId);
  if (!group) return null;
  const members = await listGroupMembers(groupId);
  return {
    ...group,
    memberIds: members.map((member) => member.id),
    members: members.map((member) => ({
      id: member.id,
      username: member.username,
      nickname: member.nickname,
      departmentName: member.departmentName,
    })),
  };
}

// ─── 成员管理 ────────────────────────────────────────────────────────────────

async function ensureGroupAccessible(groupId: number) {
  const tc = tenantCondition(userGroups, currentUser());
  const [row] = await db
    .select({ id: userGroups.id, tenantId: userGroups.tenantId, memberMode: userGroups.memberMode })
    .from(userGroups)
    .where(and(eq(userGroups.id, groupId), tc))
    .limit(1);
  requireRow(row, '用户组不存在');
  return row;
}

/** 动态组成员由规则物化，禁止手工增删（例外走规则的强制包含/排除名单） */
function ensureStaticGroup(group: { memberMode: string }) {
  if (group.memberMode === 'dynamic') {
    throw new HTTPException(400, { message: '动态用户组的成员由规则自动维护，请通过编辑规则调整（支持强制包含/排除名单）' });
  }
}

/** 规则 dry-run（新建组预览时 groupId 为空，租户取当前操作者的建组租户） */
export async function previewUserGroupRule(input: { groupId?: number; memberRule: UserGroupMemberRule }): Promise<RulePreviewResult> {
  if (input.groupId != null) {
    await ensureGroupAccessible(input.groupId);
    return previewDynamicGroupRule(input.memberRule, { groupId: input.groupId, tenantId: null });
  }
  return previewDynamicGroupRule(input.memberRule, { tenantId: getCreateTenantId(currentUser()) });
}

/** 手动触发动态组成员同步 */
export async function syncUserGroupNow(id: number): Promise<{ added: number; removed: number }> {
  const group = await ensureGroupAccessible(id);
  if (group.memberMode !== 'dynamic') {
    throw new HTTPException(400, { message: '仅动态用户组支持手动同步' });
  }
  return syncDynamicGroup(id);
}

export async function listGroupMembers(groupId: number) {
  await ensureGroupAccessible(groupId);
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      nickname: users.nickname,
      email: users.email,
      departmentName: departments.name,
      joinedAt: userGroupMembers.createdAt,
    })
    .from(userGroupMembers)
    .innerJoin(users, eq(users.id, userGroupMembers.userId))
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(eq(userGroupMembers.groupId, groupId))
    .orderBy(asc(users.id));

  return rows.map(r => ({
    id: r.id,
    username: r.username,
    nickname: r.nickname,
    email: r.email ?? null,
    departmentName: r.departmentName ?? null,
    joinedAt: formatDateTime(r.joinedAt),
  }));
}

export async function setGroupMembers(groupId: number, userIds: number[]) {
  const group = await ensureGroupAccessible(groupId);
  ensureStaticGroup(group);
  const uniqueUserIds = await validateScopeUserIds(userIds, group.tenantId);
  const previous = await db.select({ userId: userGroupMembers.userId }).from(userGroupMembers).where(eq(userGroupMembers.groupId, groupId));
  await db.transaction(async (tx) => {
    await tx.delete(userGroupMembers).where(eq(userGroupMembers.groupId, groupId));
    if (uniqueUserIds.length > 0) {
      await tx.insert(userGroupMembers).values(uniqueUserIds.map(userId => ({ groupId, userId })));
    }
  });
  // 组可能绑定角色：成员进出影响其继承权限，前后成员均需清缓存
  await Promise.all([...new Set([...previous.map((r) => r.userId), ...uniqueUserIds])].map((uid) => clearUserPermissionCache(uid)));
}

export async function addGroupMembers(groupId: number, userIds: number[]) {
  const group = await ensureGroupAccessible(groupId);
  ensureStaticGroup(group);
  const uniqueUserIds = await validateScopeUserIds(userIds, group.tenantId);
  if (uniqueUserIds.length === 0) return;
  const existing = await db
    .select({ userId: userGroupMembers.userId })
    .from(userGroupMembers)
    .where(and(eq(userGroupMembers.groupId, groupId), inArray(userGroupMembers.userId, uniqueUserIds)));
  const exists = new Set(existing.map(r => r.userId));
  const toAdd = uniqueUserIds.filter(id => !exists.has(id));
  if (toAdd.length > 0) {
    await db.insert(userGroupMembers).values(toAdd.map(uid => ({ groupId, userId: uid })));
    await Promise.all(toAdd.map((uid) => clearUserPermissionCache(uid)));
  }
}

export async function removeGroupMembers(groupId: number, userIds: number[]) {
  const group = await ensureGroupAccessible(groupId);
  ensureStaticGroup(group);
  if (userIds.length === 0) return;
  await db.delete(userGroupMembers)
    .where(and(eq(userGroupMembers.groupId, groupId), inArray(userGroupMembers.userId, userIds)));
  await Promise.all(userIds.map((uid) => clearUserPermissionCache(uid)));
}

// ─── 角色管理 ────────────────────────────────────────────────────────────────

/** 用户组已绑定的角色列表 */
export async function listGroupRoles(groupId: number) {
  await ensureGroupAccessible(groupId);
  const rows = await db
    .select({ id: roles.id, name: roles.name, code: roles.code, status: roles.status })
    .from(userGroupRoles)
    .innerJoin(roles, eq(roles.id, userGroupRoles.roleId))
    .where(eq(userGroupRoles.groupId, groupId))
    .orderBy(asc(roles.id));
  return rows;
}

/** 全量覆盖用户组绑定的角色，组内成员的继承权限即时生效 */
export async function setGroupRoles(groupId: number, roleIds: number[]) {
  await ensureGroupAccessible(groupId);
  const uniqueRoleIds = [...new Set(roleIds)];
  if (uniqueRoleIds.length > 0) {
    const tc = tenantCondition(roles, currentUser());
    const found = await db.select({ id: roles.id }).from(roles)
      .where(buildWhere(inArray(roles.id, uniqueRoleIds), tc));
    if (found.length !== uniqueRoleIds.length) throw new HTTPException(400, { message: '包含不存在的角色' });
  }
  await db.transaction(async (tx) => {
    await tx.delete(userGroupRoles).where(eq(userGroupRoles.groupId, groupId));
    if (uniqueRoleIds.length > 0) {
      await tx.insert(userGroupRoles).values(uniqueRoleIds.map((roleId) => ({ groupId, roleId })));
    }
  });
  // 组内所有成员的权限受影响，清缓存即时生效
  const members = await db.select({ userId: userGroupMembers.userId }).from(userGroupMembers).where(eq(userGroupMembers.groupId, groupId));
  await Promise.all(members.map((m) => clearUserPermissionCache(m.userId)));
}

export async function getUserGroupRolesBeforeAudit(groupId: number) {
  const group = await getUserGroupBeforeAudit(groupId);
  if (!group) return null;
  const groupRoles = await listGroupRoles(groupId);
  return {
    id: group.id,
    name: group.name,
    code: group.code,
    roleIds: groupRoles.map((r) => r.id),
    roles: groupRoles.map((r) => ({ id: r.id, name: r.name, code: r.code })),
  };
}
