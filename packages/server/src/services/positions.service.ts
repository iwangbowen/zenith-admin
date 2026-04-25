import { and, asc, eq, gte, inArray, like, lte, or } from 'drizzle-orm';
import { db } from '../db';
import { positions, userPositions } from '../db/schema';
import { AppError } from '../lib/errors';
import { currentUser } from '../lib/context';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { exportToExcel } from '../lib/excel-export';
import { pageOffset } from '../lib/pagination';
import { rethrowPgUniqueViolation } from '../lib/db-errors';

export function mapPosition(row: typeof positions.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    sort: row.sort,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface CreatePositionInput {
  name: string;
  code: string;
  sort?: number;
  status?: 'active' | 'disabled';
  remark?: string;
}
export type UpdatePositionInput = Partial<CreatePositionInput>;

export interface ListPositionsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'active' | 'disabled';
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
    conditions.push(or(like(positions.name, `%${q.keyword}%`), like(positions.code, `%${q.keyword}%`)));
  }
  if (q.status) conditions.push(eq(positions.status, q.status));
  if (q.startTime) conditions.push(gte(positions.createdAt, new Date(q.startTime)));
  if (q.endTime) conditions.push(lte(positions.createdAt, new Date(q.endTime)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const tc = tenantCondition(positions, currentUser());
  const finalWhere = where && tc ? and(where, tc) : (tc ?? where);

  const [total, list] = await Promise.all([
    db.$count(positions, finalWhere),
    db
      .select()
      .from(positions)
      .where(finalWhere)
      .orderBy(asc(positions.sort), asc(positions.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);

  return { list: list.map(mapPosition), total, page, pageSize };
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
    if (!row) throw new AppError('岗位不存在', 404);
    return mapPosition(row);
  } catch (err) {
    if (err instanceof AppError) throw err;
    rethrowPgUniqueViolation(err, '岗位编码已存在');
  }
}

export async function deletePosition(id: number): Promise<void> {
  const tc = tenantCondition(positions, currentUser());
  const [pos] = await db.select({ id: positions.id }).from(positions).where(and(eq(positions.id, id), tc)).limit(1);
  if (!pos) throw new AppError('岗位不存在', 404);

  const [binding] = await db
    .select({ positionId: userPositions.positionId })
    .from(userPositions)
    .where(eq(userPositions.positionId, id))
    .limit(1);
  if (binding) throw new AppError('该岗位下仍有关联用户，无法删除', 400);

  await db.delete(positions).where(and(eq(positions.id, id), tc));
}

export async function batchDeletePositions(ids: number[]): Promise<{ count: number }> {
  if (!Array.isArray(ids) || ids.length === 0) throw new AppError('请选择要删除的岗位', 400);
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) throw new AppError('岗位ID格式无效', 400);

  const bindings = await db
    .select({ positionId: userPositions.positionId })
    .from(userPositions)
    .where(inArray(userPositions.positionId, validIds));
  if (bindings.length > 0) throw new AppError('所选岗位中存在关联用户，无法删除', 400);

  await db.delete(positions).where(and(inArray(positions.id, validIds), tenantCondition(positions, currentUser())));
  return { count: validIds.length };
}

export async function exportPositions(): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const rows = await db
    .select()
    .from(positions)
    .where(tenantCondition(positions, currentUser()))
    .orderBy(asc(positions.sort));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '岗位名称', key: 'name', width: 18 },
      { header: '岗位编码', key: 'code', width: 18 },
      { header: '排序', key: 'sort', width: 8 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'active' ? '启用' : '禁用') },
      { header: '备注', key: 'remark', width: 24 },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, remark: r.remark ?? '', createdAt: r.createdAt.toISOString() })),
    '岗位列表',
  );
  return { buffer, filename: 'positions.xlsx' };
}
