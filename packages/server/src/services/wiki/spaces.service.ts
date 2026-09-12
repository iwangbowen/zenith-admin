import { HTTPException } from 'hono/http-exception';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import type { CreateWikiSpaceInput, SaveWikiSpaceMembersInput, UpdateWikiSpaceInput, WikiSpaceMemberRole } from '@zenith/shared/wiki';
import { wikiSpaceContract } from '@zenith/shared/wiki';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { users, wikiDocs, wikiSpaceMembers, wikiSpaces, type WikiSpaceRow } from '../../db/schema';
import { currentUser, isSuperAdmin } from '../../lib/context';
import { formatDateTime, formatTimestamps } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';

// ─── 角色等级 ─────────────────────────────────────────────────────────────────

const ROLE_RANK: Record<WikiSpaceMemberRole, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

export function mapWikiSpace(row: WikiSpaceRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    icon: row.icon ?? null,
    visibility: row.visibility,
    status: row.status,
    sort: row.sort,
    aiSyncEnabled: row.aiSyncEnabled,
    tenantId: row.tenantId ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    ...formatTimestamps(row),
  };
}

type WikiSpaceListFilter = Omit<QueryOutputOf<typeof wikiSpaceContract.list>, 'page' | 'pageSize'>;

interface WikiSpaceWhereInput extends WikiSpaceListFilter {
  id?: number;
}

function buildWikiSpaceWhere(q: WikiSpaceWhereInput) {
  return buildWhere(
    q.id !== undefined ? eq(wikiSpaces.id, q.id) : undefined,
    keywordCondition(q.keyword, [wikiSpaces.name, wikiSpaces.description]),
    q.visibility ? eq(wikiSpaces.visibility, q.visibility) : undefined,
    q.status ? eq(wikiSpaces.status, q.status) : undefined,
    tenantCondition(wikiSpaces, currentUser()),
  );
}

// ─── 管理端：空间 CRUD ────────────────────────────────────────────────────────

export async function listWikiSpaces(q: QueryOutputOf<typeof wikiSpaceContract.list>) {
  const { page, pageSize } = q;
  const where = buildWikiSpaceWhere(q);

  const { list: rows, total } = await buildListResult({
    page,
    pageSize,
    count: () => db.$count(wikiSpaces, where),
    rows: () => withPagination(
      db.select().from(wikiSpaces).where(where).orderBy(asc(wikiSpaces.sort), asc(wikiSpaces.id)).$dynamic(),
      page,
      pageSize,
    ),
  });

  const ids = rows.map((r) => r.id);
  const [memberCounts, docCounts] = await Promise.all([
    ids.length
      ? db.select({ spaceId: wikiSpaceMembers.spaceId, count: sql<number>`count(*)::int` })
        .from(wikiSpaceMembers).where(inArray(wikiSpaceMembers.spaceId, ids)).groupBy(wikiSpaceMembers.spaceId)
      : Promise.resolve([]),
    ids.length
      ? db.select({ spaceId: wikiDocs.spaceId, count: sql<number>`count(*)::int` })
        .from(wikiDocs).where(buildWhere(inArray(wikiDocs.spaceId, ids), sql`${wikiDocs.deletedAt} is null`)).groupBy(wikiDocs.spaceId)
      : Promise.resolve([]),
  ]);
  const memberMap = new Map(memberCounts.map((r) => [r.spaceId, r.count]));
  const docMap = new Map(docCounts.map((r) => [r.spaceId, r.count]));

  return {
    list: rows.map((r) => ({ ...mapWikiSpace(r), memberCount: memberMap.get(r.id) ?? 0, docCount: docMap.get(r.id) ?? 0 })),
    total,
    page,
    pageSize,
  };
}

export async function ensureWikiSpaceExists(id: number) {
  const [row] = await db.select().from(wikiSpaces).where(buildWikiSpaceWhere({ id })).limit(1);
  return requireRow(row, '知识空间不存在');
}

export async function getWikiSpace(id: number) {
  const row = await ensureWikiSpaceExists(id);
  return { ...mapWikiSpace(row), myRole: await getMySpaceRole(id) };
}

export async function createWikiSpace(data: CreateWikiSpaceInput) {
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(wikiSpaces).values({
      ...data,
      tenantId: getCreateTenantId(currentUser()),
    }).returning();
    // 创建人自动成为空间负责人
    await tx.insert(wikiSpaceMembers).values({ spaceId: created.id, userId: currentUser().userId, role: 'owner' });
    return created;
  });
  return mapWikiSpace(row);
}

export async function updateWikiSpace(id: number, data: UpdateWikiSpaceInput) {
  await ensureSpaceRole(id, 'admin');
  const [row] = await db.update(wikiSpaces).set(data).where(buildWikiSpaceWhere({ id })).returning();
  return mapWikiSpace(requireRow(row, '知识空间不存在'));
}

export async function deleteWikiSpace(id: number) {
  await ensureSpaceRole(id, 'owner');
  const docCount = await db.$count(wikiDocs, eq(wikiDocs.spaceId, id));
  if (docCount > 0) throw new HTTPException(400, { message: `空间下仍有 ${docCount} 篇文档（含回收站），请先清空后再删除` });
  await db.delete(wikiSpaces).where(buildWikiSpaceWhere({ id }));
}

// ─── 空间成员 ─────────────────────────────────────────────────────────────────

export async function listWikiSpaceMembers(spaceId: number) {
  await ensureWikiSpaceExists(spaceId);
  const rows = await db.select({
    spaceId: wikiSpaceMembers.spaceId,
    userId: wikiSpaceMembers.userId,
    role: wikiSpaceMembers.role,
    username: users.username,
    nickname: users.nickname,
    createdAt: wikiSpaceMembers.createdAt,
  }).from(wikiSpaceMembers)
    .leftJoin(users, eq(wikiSpaceMembers.userId, users.id))
    .where(eq(wikiSpaceMembers.spaceId, spaceId))
    .orderBy(asc(wikiSpaceMembers.userId));
  return rows.map((r) => ({
    spaceId: r.spaceId,
    userId: r.userId,
    role: r.role,
    username: r.username ?? undefined,
    nickname: r.nickname ?? null,
    createdAt: formatDateTime(r.createdAt),
  }));
}

/** 先删后插，原子性替换空间成员 */
async function setWikiSpaceMembers(executor: DbExecutor, spaceId: number, members: SaveWikiSpaceMembersInput['members']) {
  await executor.delete(wikiSpaceMembers).where(eq(wikiSpaceMembers.spaceId, spaceId));
  if (members.length > 0) {
    await executor.insert(wikiSpaceMembers).values(members.map((m) => ({ spaceId, userId: m.userId, role: m.role })));
  }
}

export async function saveWikiSpaceMembers(spaceId: number, data: SaveWikiSpaceMembersInput) {
  await ensureSpaceRole(spaceId, 'admin');
  if (!data.members.some((m) => m.role === 'owner')) {
    throw new HTTPException(400, { message: '空间至少需要一名负责人' });
  }
  await db.transaction(async (tx) => {
    await setWikiSpaceMembers(tx, spaceId, data.members);
  });
}

/** 成员分配的审计快照 */
export async function getWikiSpaceMembersBeforeAudit(spaceId: number) {
  const members = await listWikiSpaceMembers(spaceId);
  return { spaceId, members: members.map((m) => ({ userId: m.userId, nickname: m.nickname, role: m.role })) };
}

// ─── 访问控制 ─────────────────────────────────────────────────────────────────

/**
 * 当前用户在空间中的有效角色：
 * 超管 → owner；成员 → 成员角色；公开空间非成员 → viewer；私有空间非成员 → null。
 */
export async function getMySpaceRole(spaceId: number): Promise<WikiSpaceMemberRole | null> {
  const space = await ensureWikiSpaceExists(spaceId);
  if (isSuperAdmin()) return 'owner';
  const [member] = await db.select({ role: wikiSpaceMembers.role }).from(wikiSpaceMembers)
    .where(buildWhere(eq(wikiSpaceMembers.spaceId, spaceId), eq(wikiSpaceMembers.userId, currentUser().userId)))
    .limit(1);
  if (member) return member.role;
  return space.visibility === 'public' ? 'viewer' : null;
}

/** 校验当前用户在空间内至少具备 minRole 角色，返回实际角色 */
export async function ensureSpaceRole(spaceId: number, minRole: WikiSpaceMemberRole): Promise<WikiSpaceMemberRole> {
  const role = await getMySpaceRole(spaceId);
  if (!role || ROLE_RANK[role] < ROLE_RANK[minRole]) {
    throw new HTTPException(403, { message: '没有该知识空间的操作权限' });
  }
  return role;
}

/** 角色等级比较（供其他 wiki service 复用） */
export function spaceRoleAtLeast(role: WikiSpaceMemberRole | null, minRole: WikiSpaceMemberRole): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK[minRole];
}

// ─── 文档中心：我可访问的空间 ─────────────────────────────────────────────────

export async function listMyWikiSpaces() {
  const where = buildWhere(
    eq(wikiSpaces.status, 'enabled'),
    tenantCondition(wikiSpaces, currentUser()),
  );
  const rows = await db.select().from(wikiSpaces).where(where).orderBy(asc(wikiSpaces.sort), asc(wikiSpaces.id));
  if (rows.length === 0) return [];

  const memberships = await db.select({ spaceId: wikiSpaceMembers.spaceId, role: wikiSpaceMembers.role })
    .from(wikiSpaceMembers)
    .where(buildWhere(
      inArray(wikiSpaceMembers.spaceId, rows.map((r) => r.id)),
      eq(wikiSpaceMembers.userId, currentUser().userId),
    ));
  const roleMap = new Map(memberships.map((m) => [m.spaceId, m.role]));
  const superAdmin = isSuperAdmin();

  return rows
    .map((r) => {
      const myRole: WikiSpaceMemberRole | null = superAdmin ? 'owner'
        : roleMap.get(r.id) ?? (r.visibility === 'public' ? 'viewer' : null);
      return { ...mapWikiSpace(r), myRole };
    })
    .filter((r) => r.myRole !== null);
}
