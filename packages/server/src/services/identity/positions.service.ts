import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { db } from '../../db';
import { positions, userPositions, users } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { formatDateTime } from '../../lib/datetime';
import { getScopeMemberSummaries, validateScopeUserIds } from './user-scope.service';

export function mapPosition(row: typeof positions.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    sort: row.sort,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export interface CreatePositionInput {
  name: string;
  code: string;
  sort?: number;
  status?: 'enabled' | 'disabled';
  remark?: string;
}
export type UpdatePositionInput = Partial<CreatePositionInput>;

export interface ListPositionsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'enabled' | 'disabled';
  startTime?: string;
  endTime?: string;
}

export async function listAllPositions() {
  const tc = tenantCondition(positions, currentUser());
  const list = await db.select().from(positions).where(tc).orderBy(asc(positions.sort), asc(positions.id));
  return list.map(mapPosition);
}

export async function listPositions(q: ListPositionsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conditions = [];
  conditions.push(keywordCondition(q.keyword, [positions.name, positions.code]));
  if (q.status) conditions.push(eq(positions.status, q.status));
  conditions.push(...dateRangeConditions(positions.createdAt, q.startTime, q.endTime));

  const where = and(...conditions);
  const tc = tenantCondition(positions, currentUser());
  const finalWhere = buildWhere(where, tc);

  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(positions, finalWhere),
    rows: async () => {
      const list = await withPagination(
        db.select().from(positions).where(finalWhere).orderBy(asc(positions.sort), asc(positions.id)).$dynamic(),
        page, pageSize,
      );
      const memberSummaries = await getScopeMemberSummaries('position', list.map((row) => row.id));
      return list.map((row) => ({
        ...mapPosition(row),
        userCount: memberSummaries.get(row.id)?.count ?? 0,
        userPreview: memberSummaries.get(row.id)?.preview ?? [],
      }));
    },
  });
}

export async function createPosition(input: CreatePositionInput) {
  try {
    const [row] = await db
      .insert(positions)
      .values({ ...input, tenantId: getCreateTenantId(currentUser()) })
      .returning();
    return mapPosition(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '岗位编码已存在');
  }
}

export async function updatePosition(id: number, input: UpdatePositionInput) {
  const tc = tenantCondition(positions, currentUser());
  try {
    const [row] = await db
      .update(positions)
      .set({ ...input })
      .where(and(eq(positions.id, id), tc))
      .returning();
    requireRow(row, '岗位不存在');
    return mapPosition(row);
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    rethrowPgUniqueViolation(err, '岗位编码已存在');
  }
}

export async function deletePosition(id: number): Promise<void> {
  const tc = tenantCondition(positions, currentUser());
  const [pos] = await db.select({ id: positions.id }).from(positions).where(and(eq(positions.id, id), tc)).limit(1);
  requireRow(pos, '岗位不存在');

  const [binding] = await db
    .select({ positionId: userPositions.positionId })
    .from(userPositions)
    .where(eq(userPositions.positionId, id))
    .limit(1);
  if (binding) throw new HTTPException(400, { message: '该岗位下仍有关联用户，无法删除' });

  await db.delete(positions).where(and(eq(positions.id, id), tc));
}

export async function batchDeletePositions(ids: number[]): Promise<{ count: number }> {
  if (!Array.isArray(ids) || ids.length === 0) throw new HTTPException(400, { message: '请选择要删除的岗位' });
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) throw new HTTPException(400, { message: '岗位ID格式无效' });

  const bindings = await db
    .select({ positionId: userPositions.positionId })
    .from(userPositions)
    .where(inArray(userPositions.positionId, validIds));
  if (bindings.length > 0) throw new HTTPException(400, { message: '所选岗位中存在关联用户，无法删除' });

  await db.delete(positions).where(and(inArray(positions.id, validIds), tenantCondition(positions, currentUser())));
  return { count: validIds.length };
}

export async function getPositionsBeforeAudit(ids: number[]) {
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) return [];
  const tc = tenantCondition(positions, currentUser());
  const rows = await db.select().from(positions).where(and(inArray(positions.id, validIds), tc)).orderBy(asc(positions.sort), asc(positions.id));
  return rows.map(mapPosition);
}

export async function getPosition(id: number) {
  const tc = tenantCondition(positions, currentUser());
  const [row] = await db.select().from(positions).where(and(eq(positions.id, id), tc)).limit(1);
  requireRow(row, '岗位不存在');
  return mapPosition(row);
}

export async function getPositionBeforeAudit(id: number) {
  const tc = tenantCondition(positions, currentUser());
  const [row] = await db.select().from(positions).where(and(eq(positions.id, id), tc)).limit(1);
  if (!row) return null;
  return mapPosition(row);
}

export async function getPositionMembersBeforeAudit(positionId: number) {
  const position = await getPositionBeforeAudit(positionId);
  if (!position) return null;
  const members = await listPositionMembers(positionId);
  return {
    ...position,
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

async function ensurePositionAccessible(positionId: number) {
  const tc = tenantCondition(positions, currentUser());
  const [row] = await db
    .select({ id: positions.id, tenantId: positions.tenantId })
    .from(positions)
    .where(and(eq(positions.id, positionId), tc))
    .limit(1);
  requireRow(row, '岗位不存在');
  return row.tenantId;
}

export async function listPositionMembers(positionId: number) {
  await ensurePositionAccessible(positionId);
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      nickname: users.nickname,
      email: users.email,
      avatar: users.avatar,
      departmentName: sql<string | null>`(SELECT name FROM departments WHERE id = ${users.departmentId})`,
      createdAt: users.createdAt,
    })
    .from(userPositions)
    .innerJoin(users, eq(users.id, userPositions.userId))
    .where(eq(userPositions.positionId, positionId))
    .orderBy(asc(users.id));

  return rows.map(r => ({
    id: r.id,
    username: r.username,
    nickname: r.nickname,
    email: r.email ?? null,
    avatar: r.avatar ?? null,
    departmentName: r.departmentName ?? null,
    joinedAt: formatDateTime(r.createdAt),
  }));
}

export async function setPositionMembers(positionId: number, userIds: number[]) {
  const tenantId = await ensurePositionAccessible(positionId);
  const uniqueUserIds = await validateScopeUserIds(userIds, tenantId);
  await db.transaction(async (tx) => {
    await tx.delete(userPositions).where(eq(userPositions.positionId, positionId));
    if (uniqueUserIds.length > 0) {
      await tx.insert(userPositions).values(uniqueUserIds.map(userId => ({ positionId, userId })));
    }
  });
}
