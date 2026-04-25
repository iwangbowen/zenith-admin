import { eq, asc, and, or, like, gte, lte, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { dicts, dictItems } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { exportToExcel } from '../lib/excel-export';
import { currentUser } from '../lib/context';
import { AppError } from '../lib/errors';
import { rethrowPgUniqueViolation } from '../lib/db-errors';

export function mapDict(row: typeof dicts.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export function mapDictItem(row: typeof dictItems.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export interface ListDictsQuery {
  keyword?: string;
  status?: 'active' | 'disabled';
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
    const kw = or(like(dicts.name, `%${keyword}%`), like(dicts.code, `%${keyword}%`));
    if (kw) conditions.push(kw);
  }
  if (status) conditions.push(eq(dicts.status, status));
  if (startDate) conditions.push(gte(dicts.createdAt, new Date(startDate)));
  if (endDate) conditions.push(lte(dicts.createdAt, new Date(`${endDate}T23:59:59.999Z`)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const tc = tenantCondition(dicts, user);
  const finalWhere = where && tc ? and(where, tc) : (tc ?? where);
  const [total, list] = await Promise.all([
    db.$count(dicts, finalWhere),
    db.select().from(dicts).where(finalWhere).orderBy(dicts.id).limit(pageSize).offset(pageOffset(page, pageSize)),
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
  if (!row) throw new AppError('字典不存在', 404);
  return mapDict(row);
}

export async function deleteDict(id: number) {
  const user = currentUser();
  const [row] = await db
    .delete(dicts)
    .where(and(eq(dicts.id, id), tenantCondition(dicts, user)))
    .returning();
  if (!row) throw new AppError('字典不存在', 404);
}

export async function listDictItems(dictId: number) {
  const items = await db.select().from(dictItems).where(eq(dictItems.dictId, dictId)).orderBy(asc(dictItems.sort), asc(dictItems.id));
  return items.map(mapDictItem);
}

export async function listDictItemsByCode(code: string) {
  const [dict] = await db.select({ id: dicts.id }).from(dicts).where(eq(dicts.code, code)).limit(1);
  if (!dict) throw new AppError('字典不存在', 404);
  const items = await db.select().from(dictItems).where(eq(dictItems.dictId, dict.id)).orderBy(asc(dictItems.sort));
  return items.map(mapDictItem);
}

export async function createDictItem(dictId: number, data: Omit<typeof dictItems.$inferInsert, 'dictId'>) {
  const [row] = await db.insert(dictItems).values({ ...data, dictId }).returning();
  return mapDictItem(row);
}

export async function updateDictItem(itemId: number, data: Partial<typeof dictItems.$inferInsert>) {
  const [row] = await db.update(dictItems).set({ ...data }).where(eq(dictItems.id, itemId)).returning();
  if (!row) throw new AppError('字典项不存在', 404);
  return mapDictItem(row);
}

export async function deleteDictItem(itemId: number) {
  const [row] = await db.delete(dictItems).where(eq(dictItems.id, itemId)).returning();
  if (!row) throw new AppError('字典项不存在', 404);
}

export async function exportDicts(): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const user = currentUser();
  const rows = await db.select().from(dicts).where(tenantCondition(dicts, user)).orderBy(asc(dicts.id));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '字典名称', key: 'name', width: 20 },
      { header: '字典编码', key: 'code', width: 20 },
      { header: '备注', key: 'remark', width: 30 },
      { header: '状态', key: 'status', width: 10, transform: (v) => (v === 'active' ? '启用' : '禁用') },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    '字典列表',
  );
  return { buffer, filename: 'dicts.xlsx' };
}
