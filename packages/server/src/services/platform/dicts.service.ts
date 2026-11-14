import type { QueryOutputOf } from '@zenith/shared/core';
import { eq, asc, desc, and, inArray } from 'drizzle-orm';
import { dictContract, dictSchema } from '@zenith/shared/platform';
import { buildWhere, keywordCondition, dateRangeConditions } from '../../lib/where-helpers';
import { db } from '../../db';
import { dicts, dictItems } from '../../db/schema';
import { tenantCondition } from '../../lib/tenant';
import { formatTimestamps } from '../../lib/datetime';
import { currentUser } from '../../lib/context';
import { HTTPException } from 'hono/http-exception';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';

export const mapDict = entityMapper(dictSchema);

export function mapDictItem(row: typeof dictItems.$inferSelect) {
  return {
    ...row,
    metadata: row.metadata as Record<string, unknown> | null,
    ...formatTimestamps(row),
  };
}

export type DictListFilter = Omit<QueryOutputOf<typeof dictContract.list>, 'page' | 'pageSize'>;
export function buildDictsWhere(q: DictListFilter) {
  return buildWhere(
    keywordCondition(q.keyword, [dicts.name, dicts.code]),
    q.status ? eq(dicts.status, q.status) : undefined,
    ...dateRangeConditions(dicts.createdAt, q.startDate, q.endDate),
    tenantCondition(dicts, currentUser()),
  );
}

export const dictService = defineCrudService(dictContract, {
  table: dicts,
  map: mapDict,
  notFound: '字典不存在',
  unique: '字典编码已存在',
  tenant: true,
  list: (q) => ({
    where: [buildDictsWhere(q)],
    orderBy: [desc(dicts.createdAt)],
  }),
});

export const { list: listDicts, get: getDict, create: createDict, update: updateDict, remove: deleteDict } = dictService;

export async function listDictItems(dictId: number) {
  const user = currentUser();
  await requireFirstRow(
    db.select({ id: dicts.id }).from(dicts).where(and(eq(dicts.id, dictId), tenantCondition(dicts, user))).limit(1),
    '字典不存在',
  );
  const items = await db.select().from(dictItems).where(eq(dictItems.dictId, dictId)).orderBy(asc(dictItems.sort), asc(dictItems.id));
  return items.map(mapDictItem);
}

export async function listDictItemsByCode(code: string) {
  const user = currentUser();
  const dict = await requireFirstRow(
    db.select({ id: dicts.id }).from(dicts).where(and(eq(dicts.code, code), tenantCondition(dicts, user))).limit(1),
    '字典不存在',
  );
  const items = await db.select().from(dictItems).where(eq(dictItems.dictId, dict.id)).orderBy(asc(dictItems.sort));
  return items.map(mapDictItem);
}

/**
 * 按编码批量取字典项（审批单打印 / 渲染时一张表单引用多个字典）：两条查询取回全部，替代每个编码两次往返。
 * 不存在 / 越租户的编码在结果里没有对应键，调用方自行决定退回原值展示。
 */
export async function listDictItemsByCodes(codes: string[]) {
  const result = new Map<string, ReturnType<typeof mapDictItem>[]>();
  const uniqueCodes = [...new Set(codes)];
  if (uniqueCodes.length === 0) return result;
  const user = currentUser();
  const dictRows = await db.select({ id: dicts.id, code: dicts.code }).from(dicts)
    .where(and(inArray(dicts.code, uniqueCodes), tenantCondition(dicts, user)));
  if (dictRows.length === 0) return result;
  const codeById = new Map(dictRows.map((row) => [row.id, row.code]));
  const items = await db.select().from(dictItems)
    .where(inArray(dictItems.dictId, [...codeById.keys()]))
    .orderBy(asc(dictItems.dictId), asc(dictItems.sort), asc(dictItems.id));
  for (const row of dictRows) result.set(row.code, []);
  for (const item of items) result.get(codeById.get(item.dictId)!)?.push(mapDictItem(item));
  return result;
}

export async function createDictItem(dictId: number, data: Omit<typeof dictItems.$inferInsert, 'dictId'>) {
  const user = currentUser();
  await requireFirstRow(
    db.select({ id: dicts.id }).from(dicts).where(and(eq(dicts.id, dictId), tenantCondition(dicts, user))).limit(1),
    '字典不存在',
  );
  if (data.parentId) {
    const [parentItem] = await db
      .select({ id: dictItems.id })
      .from(dictItems)
      .where(and(eq(dictItems.id, data.parentId), eq(dictItems.dictId, dictId)))
      .limit(1);
    requireRow(parentItem, '父级字典项不存在或不属于当前字典', 400);
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
  requireRow(item, '字典项不存在');
  if (data.parentId !== undefined && data.parentId !== null) {
    if (data.parentId === itemId) throw new HTTPException(400, { message: '不能将自身设为父级' });
    const [parentItem] = await db
      .select({ id: dictItems.id })
      .from(dictItems)
      .where(eq(dictItems.id, data.parentId))
      .limit(1);
    requireRow(parentItem, '父级字典项不存在', 400);
    // 循环引用检测：新父级不能是当前项的子孙节点
    const isDescendant = async (checkId: number): Promise<boolean> => {
      const [row] = await db.select({ parentId: dictItems.parentId }).from(dictItems).where(eq(dictItems.id, checkId)).limit(1);
      if (row?.parentId == null) return false;
      if (row.parentId === itemId) return true;
      return isDescendant(row.parentId);
    };
    if (await isDescendant(data.parentId)) {
      throw new HTTPException(400, { message: '不能将父级设置为自身的子孙节点（循环引用）' });
    }
  }
  const [row] = await db.update(dictItems).set({ ...data }).where(eq(dictItems.id, itemId)).returning();
  return mapDictItem(row);
}

export async function deleteDictItem(itemId: number) {
  const user = currentUser();
  await requireFirstRow(
    db
      .select({ id: dictItems.id })
      .from(dictItems)
      .innerJoin(dicts, and(eq(dicts.id, dictItems.dictId), tenantCondition(dicts, user)))
      .where(eq(dictItems.id, itemId))
      .limit(1),
    '字典项不存在',
  );
  await db.delete(dictItems).where(eq(dictItems.id, itemId));
}

export async function getDictItem(dictId: number, itemId: number) {
  const user = currentUser();
  await requireFirstRow(
    db.select({ id: dicts.id }).from(dicts).where(and(eq(dicts.id, dictId), tenantCondition(dicts, user))).limit(1),
    '字典不存在',
  );
  const row = await requireFirstRow(
    db.select().from(dictItems).where(and(eq(dictItems.id, itemId), eq(dictItems.dictId, dictId))).limit(1),
    '字典项不存在',
  );
  return mapDictItem(row);
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
