import { eq, asc, and, or, like, gte, lte, type SQL } from 'drizzle-orm';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import { dicts, dictItems } from '../db/schema';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { streamToExcel, formatDateTimeForExcel } from '../lib/excel-export';
import { formatDateTime, parseDateRangeEnd, parseDateRangeStart } from '../lib/datetime';
import { currentUser } from '../lib/context';
import { HTTPException } from 'hono/http-exception';
import { rethrowPgUniqueViolation } from '../lib/db-errors';

export function mapDict(row: typeof dicts.$inferSelect) {
  return { ...row, createdAt: formatDateTime(row.createdAt), updatedAt: formatDateTime(row.updatedAt) };
}

export function mapDictItem(row: typeof dictItems.$inferSelect) {
  return { ...row, createdAt: formatDateTime(row.createdAt), updatedAt: formatDateTime(row.updatedAt) };
}

export interface ListDictsQuery {
  keyword?: string;
  status?: 'enabled' | 'disabled';
  startDate?: string;
  endDate?: string;
  page: number;
  pageSize: number;
}

export async function listDicts(q: ListDictsQuery) {
  const user = currentUser();
  const { keyword = '', status = '', startDate = '', endDate = '', page, pageSize } = q;
  const conditions: SQL[] = [];
  if (keyword) {
    const kw = or(like(dicts.name, `%${escapeLike(keyword)}%`), like(dicts.code, `%${escapeLike(keyword)}%`));
    if (kw) conditions.push(kw);
  }
  if (status) conditions.push(eq(dicts.status, status));
  const parsedStartDate = parseDateRangeStart(startDate);
  const parsedEndDate = parseDateRangeEnd(endDate);
  if (parsedStartDate) conditions.push(gte(dicts.createdAt, parsedStartDate));
  if (parsedEndDate) conditions.push(lte(dicts.createdAt, parsedEndDate));
  const where = and(...conditions);
  const tc = tenantCondition(dicts, user);
  const finalWhere = mergeWhere(where, tc);
  const [total, list] = await Promise.all([
    db.$count(dicts, finalWhere),
    withPagination(db.select().from(dicts).where(finalWhere).orderBy(dicts.id).$dynamic(), page, pageSize),
  ]);
  return { list: list.map(mapDict), total, page, pageSize };
}

export async function createDict(data: typeof dicts.$inferInsert) {
  const user = currentUser();
  try {
    const [row] = await db.insert(dicts).values({ ...data, tenantId: getCreateTenantId(user) }).returning();
    return mapDict(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '字典编码已存在');
  }
}

export async function updateDict(id: number, data: Partial<typeof dicts.$inferInsert>) {
  const user = currentUser();
  const [row] = await db
    .update(dicts)
    .set({ ...data })
    .where(and(eq(dicts.id, id), tenantCondition(dicts, user)))
    .returning();
  if (!row) throw new HTTPException(404, { message: '字典不存在' });
  return mapDict(row);
}

export async function deleteDict(id: number) {
  const user = currentUser();
  const [row] = await db
    .delete(dicts)
    .where(and(eq(dicts.id, id), tenantCondition(dicts, user)))
    .returning();
  if (!row) throw new HTTPException(404, { message: '字典不存在' });
}

export async function listDictItems(dictId: number) {
  const user = currentUser();
  const [dict] = await db.select({ id: dicts.id }).from(dicts).where(and(eq(dicts.id, dictId), tenantCondition(dicts, user))).limit(1);
  if (!dict) throw new HTTPException(404, { message: '字典不存在' });
  const items = await db.select().from(dictItems).where(eq(dictItems.dictId, dictId)).orderBy(asc(dictItems.sort), asc(dictItems.id));
  return items.map(mapDictItem);
}

export async function listDictItemsByCode(code: string) {
  const user = currentUser();
  const [dict] = await db.select({ id: dicts.id }).from(dicts).where(and(eq(dicts.code, code), tenantCondition(dicts, user))).limit(1);
  if (!dict) throw new HTTPException(404, { message: '字典不存在' });
  const items = await db.select().from(dictItems).where(eq(dictItems.dictId, dict.id)).orderBy(asc(dictItems.sort));
  return items.map(mapDictItem);
}

export async function createDictItem(dictId: number, data: Omit<typeof dictItems.$inferInsert, 'dictId'>) {
  const user = currentUser();
  const [dict] = await db.select({ id: dicts.id }).from(dicts).where(and(eq(dicts.id, dictId), tenantCondition(dicts, user))).limit(1);
  if (!dict) throw new HTTPException(404, { message: '字典不存在' });
  if (data.parentId) {
    const [parentItem] = await db
      .select({ id: dictItems.id, parentId: dictItems.parentId })
      .from(dictItems)
      .where(and(eq(dictItems.id, data.parentId), eq(dictItems.dictId, dictId)))
      .limit(1);
    if (!parentItem) throw new HTTPException(400, { message: '父级字典项不存在或不属于当前字典' });
    if (parentItem.parentId) throw new HTTPException(400, { message: '只支持两级结构，不能嵌套三级及以上' });
  }
  const [row] = await db.insert(dictItems).values({ ...data, dictId }).returning();
  return mapDictItem(row);
}

export async function updateDictItem(itemId: number, data: Partial<typeof dictItems.$inferInsert>) {
  const user = currentUser();
  const [item] = await db
    .select({ id: dictItems.id, parentId: dictItems.parentId })
    .from(dictItems)
    .innerJoin(dicts, and(eq(dicts.id, dictItems.dictId), tenantCondition(dicts, user)))
    .where(eq(dictItems.id, itemId))
    .limit(1);
  if (!item) throw new HTTPException(404, { message: '字典项不存在' });
  if (data.parentId !== undefined && data.parentId !== null) {
    const [parentItem] = await db
      .select({ id: dictItems.id, parentId: dictItems.parentId })
      .from(dictItems)
      .where(eq(dictItems.id, data.parentId))
      .limit(1);
    if (!parentItem) throw new HTTPException(400, { message: '父级字典项不存在' });
    if (parentItem.parentId) throw new HTTPException(400, { message: '只支持两级结构，不能嵌套三级及以上' });
    const childCount = await db.$count(dictItems, eq(dictItems.parentId, itemId));
    if (childCount > 0) throw new HTTPException(400, { message: '该字典项已有子项，不能设置为子项' });
  }
  const [row] = await db.update(dictItems).set({ ...data }).where(eq(dictItems.id, itemId)).returning();
  return mapDictItem(row);
}

export async function deleteDictItem(itemId: number) {
  const user = currentUser();
  const [item] = await db
    .select({ id: dictItems.id })
    .from(dictItems)
    .innerJoin(dicts, and(eq(dicts.id, dictItems.dictId), tenantCondition(dicts, user)))
    .where(eq(dictItems.id, itemId))
    .limit(1);
  if (!item) throw new HTTPException(404, { message: '字典项不存在' });
  await db.delete(dictItems).where(eq(dictItems.id, itemId));
}

export async function getDict(id: number) {
  const user = currentUser();
  const tc = tenantCondition(dicts, user);
  const [row] = await db.select().from(dicts).where(and(eq(dicts.id, id), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '字典不存在' });
  return mapDict(row);
}

export async function getDictBeforeAudit(id: number) {
  const user = currentUser();
  const tc = tenantCondition(dicts, user);
  const [row] = await db.select().from(dicts).where(and(eq(dicts.id, id), tc)).limit(1);
  if (!row) return null;
  return mapDict(row);
}

export async function getDictItemBeforeAudit(itemId: number) {
  const [row] = await db.select().from(dictItems).where(eq(dictItems.id, itemId)).limit(1);
  if (!row) return null;
  return mapDictItem(row);
}

export async function exportDicts(): Promise<{ stream: ReadableStream; filename: string }> {
  const user = currentUser();
  const rows = await db.select().from(dicts).where(tenantCondition(dicts, user)).orderBy(asc(dicts.id));
  const stream = await streamToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '字典名称', key: 'name', width: 20 },
      { header: '字典编码', key: 'code', width: 20 },
      { header: '备注', key: 'remark', width: 30 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'enabled' ? '启用' : '禁用') },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, createdAt: formatDateTimeForExcel(r.createdAt) })),
    '字典列表',
  );
  return { stream, filename: 'dicts.xlsx' };
}
