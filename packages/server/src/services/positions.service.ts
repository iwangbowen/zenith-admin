import { and, asc, desc, eq, gte, inArray, like, lte, or, sql } from 'drizzle-orm';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import { positions, userPositions, users } from '../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../lib/context';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { streamToExcel, streamToCsv, formatDateTimeForExcel } from '../lib/excel-export';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { formatDateTime, parseDateTimeInput } from '../lib/datetime';

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
  if (q.keyword) {
    conditions.push(or(like(positions.name, `%${escapeLike(q.keyword)}%`), like(positions.code, `%${escapeLike(q.keyword)}%`)));
  }
  if (q.status) conditions.push(eq(positions.status, q.status));
  const startTime = parseDateTimeInput(q.startTime);
  const endTime = parseDateTimeInput(q.endTime);
  if (startTime) conditions.push(gte(positions.createdAt, startTime));
  if (endTime) conditions.push(lte(positions.createdAt, endTime));

  const where = and(...conditions);
  const tc = tenantCondition(positions, currentUser());
  const finalWhere = mergeWhere(where, tc);

  const [total, list] = await Promise.all([
    db.$count(positions, finalWhere),
    withPagination(
      db.select().from(positions).where(finalWhere).orderBy(asc(positions.sort), asc(positions.id)).$dynamic(),
      page, pageSize,
    ),
  ]);

  // Fetch user count & previews (first 5 per position) for the current page
  const positionIds = list.map((p) => p.id);
  const countMap = new Map<number, number>();
  const previewMap = new Map<number, Array<{ id: number; nickname: string; avatar: string | null }>>();
  if (positionIds.length > 0) {
    const rows = await db
      .select({
        positionId: userPositions.positionId,
        id: users.id,
        nickname: users.nickname,
        avatar: users.avatar,
      })
      .from(userPositions)
      .innerJoin(users, eq(users.id, userPositions.userId))
      .where(inArray(userPositions.positionId, positionIds))
      .orderBy(asc(userPositions.positionId), asc(userPositions.userId));

    for (const row of rows) {
      countMap.set(row.positionId, (countMap.get(row.positionId) ?? 0) + 1);
      if (!previewMap.has(row.positionId)) previewMap.set(row.positionId, []);
      const arr = previewMap.get(row.positionId)!;
      if (arr.length < 5) arr.push({ id: row.id, nickname: row.nickname, avatar: row.avatar ?? null });
    }
  }

  const mappedList = list.map((row) => ({
    ...mapPosition(row),
    userCount: countMap.get(row.id) ?? 0,
    userPreview: previewMap.get(row.id) ?? [],
  }));

  return { list: mappedList, total, page, pageSize };
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
    if (!row) throw new HTTPException(404, { message: '岗位不存在' });
    return mapPosition(row);
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    rethrowPgUniqueViolation(err, '岗位编码已存在');
  }
}

export async function deletePosition(id: number): Promise<void> {
  const tc = tenantCondition(positions, currentUser());
  const [pos] = await db.select({ id: positions.id }).from(positions).where(and(eq(positions.id, id), tc)).limit(1);
  if (!pos) throw new HTTPException(404, { message: '岗位不存在' });

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
  if (!row) throw new HTTPException(404, { message: '岗位不存在' });
  return mapPosition(row);
}

export async function getPositionBeforeAudit(id: number) {
  const tc = tenantCondition(positions, currentUser());
  const [row] = await db.select().from(positions).where(and(eq(positions.id, id), tc)).limit(1);
  if (!row) return null;
  return mapPosition(row);
}

// ─── 成员管理 ────────────────────────────────────────────────────────────────

async function ensurePositionAccessible(positionId: number) {
  const tc = tenantCondition(positions, currentUser());
  const [row] = await db.select({ id: positions.id }).from(positions).where(and(eq(positions.id, positionId), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '岗位不存在' });
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
  await ensurePositionAccessible(positionId);
  await db.transaction(async (tx) => {
    await tx.delete(userPositions).where(eq(userPositions.positionId, positionId));
    if (userIds.length > 0) {
      await tx.insert(userPositions).values(userIds.map(uid => ({ positionId, userId: uid })));
    }
  });
}

export async function exportPositions(): Promise<{ stream: ReadableStream; filename: string }> {
  const rows = await db
    .select()
    .from(positions)
    .where(tenantCondition(positions, currentUser()))
    .orderBy(asc(positions.sort));
  const stream = await streamToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '岗位名称', key: 'name', width: 18 },
      { header: '岗位编码', key: 'code', width: 18 },
      { header: '排序', key: 'sort', width: 8 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'enabled' ? '启用' : '禁用') },
      { header: '备注', key: 'remark', width: 24 },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, remark: r.remark ?? '', createdAt: formatDateTimeForExcel(r.createdAt) })),
    '岗位列表',
  );
  return { stream, filename: 'positions.xlsx' };
}

export async function exportPositionsAsCsv(): Promise<{ stream: ReadableStream; filename: string }> {
  const rows = await db
    .select()
    .from(positions)
    .where(tenantCondition(positions, currentUser()))
    .orderBy(asc(positions.sort));
  const stream = streamToCsv(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '岗位名称', key: 'name', width: 18 },
      { header: '岗位编码', key: 'code', width: 18 },
      { header: '排序', key: 'sort', width: 8 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'enabled' ? '启用' : '停用') },
      { header: '备注', key: 'remark', width: 24 },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, remark: r.remark ?? '', createdAt: formatDateTimeForExcel(r.createdAt) })),
  );
  return { stream, filename: 'positions.csv' };
}
