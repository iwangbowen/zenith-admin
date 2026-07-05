import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { db } from '../../db';
import { userGroups, userGroupMembers, users, departments } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { formatDateTime } from '../../lib/datetime';

interface RawGroupRow {
  id: number;
  name: string;
  code: string;
  description: string | null;
  ownerId: number | null;
  ownerName: string | null;
  departmentId: number | null;
  departmentName: string | null;
  status: 'enabled' | 'disabled';
  memberCount: number;
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
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    memberCount: row.memberCount ?? 0,
    status: row.status,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

const memberCountSql = sql<number>`(SELECT COUNT(*)::int FROM ${userGroupMembers} WHERE ${userGroupMembers.groupId} = ${userGroups.id})`;

function baseSelect() {
  return db
    .select({
      id: userGroups.id,
      name: userGroups.name,
      code: userGroups.code,
      description: userGroups.description,
      ownerId: userGroups.ownerId,
      ownerName: users.nickname,
      departmentId: userGroups.departmentId,
      departmentName: departments.name,
      status: userGroups.status,
      memberCount: memberCountSql,
      createdAt: userGroups.createdAt,
      updatedAt: userGroups.updatedAt,
    })
    .from(userGroups)
    .leftJoin(users, eq(users.id, userGroups.ownerId))
    .leftJoin(departments, eq(departments.id, userGroups.departmentId));
}

export interface CreateUserGroupInput {
  name: string;
  code: string;
  description?: string;
  ownerId?: number | null;
  departmentId?: number | null;
  status?: 'enabled' | 'disabled';
}
export type UpdateUserGroupInput = Partial<CreateUserGroupInput>;

export interface ListUserGroupsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'enabled' | 'disabled';
}

export async function listAllUserGroups() {
  const tc = tenantCondition(userGroups, currentUser());
  const rows = await baseSelect().where(tc).orderBy(asc(userGroups.id));
  return rows.map(mapGroup);
}

export async function listUserGroups(q: ListUserGroupsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conditions = [];
  if (q.keyword) {
    conditions.push(or(like(userGroups.name, `%${escapeLike(q.keyword)}%`), like(userGroups.code, `%${escapeLike(q.keyword)}%`)));
  }
  if (q.status) conditions.push(eq(userGroups.status, q.status));

  const where = and(...conditions);
  const tc = tenantCondition(userGroups, currentUser());
  const finalWhere = mergeWhere(where, tc);

  const [total, list] = await Promise.all([
    db.$count(userGroups, finalWhere),
    withPagination(
      baseSelect().where(finalWhere).orderBy(desc(userGroups.createdAt)).$dynamic(),
      page, pageSize,
    ),
  ]);

  // Fetch member previews (first 5 per group) for the current page
  const groupIds = list.map((g) => g.id);
  const previewMap = new Map<number, Array<{ id: number; nickname: string; avatar: string | null }>>();
  if (groupIds.length > 0) {
    const previews = await db
      .select({
        groupId: userGroupMembers.groupId,
        id: users.id,
        nickname: users.nickname,
        avatar: users.avatar,
      })
      .from(userGroupMembers)
      .innerJoin(users, eq(users.id, userGroupMembers.userId))
      .where(inArray(userGroupMembers.groupId, groupIds))
      .orderBy(asc(userGroupMembers.groupId), asc(userGroupMembers.userId));

    for (const row of previews) {
      if (!previewMap.has(row.groupId)) previewMap.set(row.groupId, []);
      const arr = previewMap.get(row.groupId)!;
      if (arr.length < 5) arr.push({ id: row.id, nickname: row.nickname, avatar: row.avatar ?? null });
    }
  }

  const mappedList = list.map((row) => ({
    ...mapGroup(row),
    memberPreview: previewMap.get(row.id) ?? [],
  }));

  return { list: mappedList, total, page, pageSize };
}

export async function getUserGroup(id: number) {
  const tc = tenantCondition(userGroups, currentUser());
  const [row] = await baseSelect().where(and(eq(userGroups.id, id), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '用户组不存在' });
  return mapGroup(row);
}

export async function createUserGroup(input: CreateUserGroupInput) {
  try {
    const [row] = await db
      .insert(userGroups)
      .values({ ...input, tenantId: getCreateTenantId(currentUser()) })
      .returning();
    return getUserGroup(row.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '用户组编码已存在');
  }
}

export async function updateUserGroup(id: number, input: UpdateUserGroupInput) {
  const tc = tenantCondition(userGroups, currentUser());
  try {
    const [row] = await db
      .update(userGroups)
      .set({ ...input })
      .where(and(eq(userGroups.id, id), tc))
      .returning();
    if (!row) throw new HTTPException(404, { message: '用户组不存在' });
    return getUserGroup(row.id);
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    rethrowPgUniqueViolation(err, '用户组编码已存在');
  }
}

export async function deleteUserGroup(id: number): Promise<void> {
  const tc = tenantCondition(userGroups, currentUser());
  const [grp] = await db.select({ id: userGroups.id }).from(userGroups).where(and(eq(userGroups.id, id), tc)).limit(1);
  if (!grp) throw new HTTPException(404, { message: '用户组不存在' });
  // 在用保护：仍有成员的用户组不允许删除，避免级联清空成员关系
  const memberCount = await db.$count(userGroupMembers, eq(userGroupMembers.groupId, id));
  if (memberCount > 0) {
    throw new HTTPException(409, { message: `该用户组下仍有 ${memberCount} 名成员，请先移除成员后再删除` });
  }
  await db.delete(userGroups).where(and(eq(userGroups.id, id), tc));
}

export async function batchDeleteUserGroups(ids: number[]): Promise<{ count: number }> {
  if (!Array.isArray(ids) || ids.length === 0) throw new HTTPException(400, { message: '请选择要删除的用户组' });
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) throw new HTTPException(400, { message: '用户组ID格式无效' });
  const tc = tenantCondition(userGroups, currentUser());
  // 在用保护：任一选中用户组仍有成员时整体拒绝，并列出组名
  const blocked = await db
    .selectDistinct({ id: userGroups.id, name: userGroups.name })
    .from(userGroups)
    .innerJoin(userGroupMembers, eq(userGroupMembers.groupId, userGroups.id))
    .where(and(inArray(userGroups.id, validIds), tc));
  if (blocked.length > 0) {
    const names = blocked.slice(0, 3).map((g) => `「${g.name}」`).join('、');
    const suffix = blocked.length > 3 ? ` 等 ${blocked.length} 个用户组` : '';
    throw new HTTPException(409, { message: `${names}${suffix}仍有成员，请先移除成员后再删除` });
  }
  await db.delete(userGroups).where(and(inArray(userGroups.id, validIds), tc));
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
  const [row] = await db.select({ id: userGroups.id }).from(userGroups).where(and(eq(userGroups.id, groupId), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '用户组不存在' });
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
  await ensureGroupAccessible(groupId);
  await db.transaction(async (tx) => {
    await tx.delete(userGroupMembers).where(eq(userGroupMembers.groupId, groupId));
    if (userIds.length > 0) {
      await tx.insert(userGroupMembers).values(userIds.map(uid => ({ groupId, userId: uid })));
    }
  });
}

export async function addGroupMembers(groupId: number, userIds: number[]) {
  await ensureGroupAccessible(groupId);
  if (userIds.length === 0) return;
  const existing = await db
    .select({ userId: userGroupMembers.userId })
    .from(userGroupMembers)
    .where(and(eq(userGroupMembers.groupId, groupId), inArray(userGroupMembers.userId, userIds)));
  const exists = new Set(existing.map(r => r.userId));
  const toAdd = userIds.filter(id => !exists.has(id));
  if (toAdd.length > 0) {
    await db.insert(userGroupMembers).values(toAdd.map(uid => ({ groupId, userId: uid })));
  }
}

export async function removeGroupMembers(groupId: number, userIds: number[]) {
  await ensureGroupAccessible(groupId);
  if (userIds.length === 0) return;
  await db.delete(userGroupMembers)
    .where(and(eq(userGroupMembers.groupId, groupId), inArray(userGroupMembers.userId, userIds)));
}
