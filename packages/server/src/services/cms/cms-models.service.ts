import { eq, asc, and, or, like, inArray, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsModels, cmsModelFields, cmsChannels, cmsContents } from '../../db/schema';
import type { CmsModelRow, CmsModelFieldRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { CreateCmsModelInput, UpdateCmsModelInput, CmsModelFieldInput } from '@zenith/shared';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsModelField(row: CmsModelFieldRow) {
  return {
    id: row.id,
    modelId: row.modelId,
    name: row.name,
    label: row.label,
    fieldType: row.fieldType,
    required: row.required,
    searchable: row.searchable,
    showInList: row.showInList,
    placeholder: row.placeholder ?? null,
    defaultValue: row.defaultValue ?? null,
    options: row.options ?? null,
    sort: row.sort,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapCmsModel(row: CmsModelRow, fields?: CmsModelFieldRow[]) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description ?? null,
    isSystem: row.isSystem,
    status: row.status,
    sort: row.sort,
    ...(fields ? { fields: fields.map(mapCmsModelField) } : {}),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsModelExists(id: number): Promise<CmsModelRow> {
  const [row] = await db.select().from(cmsModels).where(eq(cmsModels.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '内容模型不存在' });
  return row;
}

export async function getCmsModel(id: number) {
  const row = await db.query.cmsModels.findFirst({
    where: eq(cmsModels.id, id),
    with: { fields: { orderBy: [asc(cmsModelFields.sort), asc(cmsModelFields.id)] } },
  });
  if (!row) throw new HTTPException(404, { message: '内容模型不存在' });
  return mapCmsModel(row, row.fields);
}

/** 获取模型的字段定义（内容编辑动态表单/检索索引用） */
export async function listCmsModelFields(modelId: number): Promise<CmsModelFieldRow[]> {
  return db.select().from(cmsModelFields)
    .where(eq(cmsModelFields.modelId, modelId))
    .orderBy(asc(cmsModelFields.sort), asc(cmsModelFields.id));
}

// ─── 列表 ─────────────────────────────────────────────────────────────────────
export interface ListCmsModelsQuery {
  keyword?: string;
  status?: 'enabled' | 'disabled';
  page: number;
  pageSize: number;
}

export async function listCmsModels(q: ListCmsModelsQuery) {
  const { keyword = '', status, page, pageSize } = q;
  const conditions: SQL[] = [];
  if (keyword) {
    const kw = or(
      like(cmsModels.name, `%${escapeLike(keyword)}%`),
      like(cmsModels.code, `%${escapeLike(keyword)}%`),
    );
    if (kw) conditions.push(kw);
  }
  if (status) conditions.push(eq(cmsModels.status, status));

  const where = mergeWhere(and(...conditions));
  const [total, rows] = await Promise.all([
    db.$count(cmsModels, where),
    withPagination(
      db.select().from(cmsModels).where(where).orderBy(asc(cmsModels.sort), asc(cmsModels.id)).$dynamic(),
      page,
      pageSize,
    ),
  ]);
  // 附带字段列表（模型数量有限，一次查回避免 N+1）
  const ids = rows.map((r) => r.id);
  const fields = ids.length > 0
    ? await db.select().from(cmsModelFields).where(inArray(cmsModelFields.modelId, ids)).orderBy(asc(cmsModelFields.sort), asc(cmsModelFields.id))
    : [];
  const fieldMap = new Map<number, CmsModelFieldRow[]>();
  for (const f of fields) {
    const arr = fieldMap.get(f.modelId) ?? [];
    arr.push(f);
    fieldMap.set(f.modelId, arr);
  }
  return { list: rows.map((r) => mapCmsModel(r, fieldMap.get(r.id) ?? [])), total, page, pageSize };
}

/** 全部启用模型（栏目绑定下拉用） */
export async function listAllCmsModels() {
  const rows = await db.select().from(cmsModels)
    .where(eq(cmsModels.status, 'enabled'))
    .orderBy(asc(cmsModels.sort), asc(cmsModels.id));
  return rows.map((r) => mapCmsModel(r));
}

/** 先删后插，原子性替换模型字段（保留 id 不变的字段做 update，避免外部引用失效） */
async function replaceModelFields(executor: DbExecutor, modelId: number, fields: CmsModelFieldInput[]): Promise<void> {
  const names = fields.map((f) => f.name);
  if (new Set(names).size !== names.length) {
    throw new HTTPException(400, { message: '字段标识重复' });
  }
  await executor.delete(cmsModelFields).where(eq(cmsModelFields.modelId, modelId));
  if (fields.length > 0) {
    await executor.insert(cmsModelFields).values(fields.map((f, i) => ({
      modelId,
      name: f.name,
      label: f.label,
      fieldType: f.fieldType ?? 'text',
      required: f.required ?? false,
      searchable: f.searchable ?? false,
      showInList: f.showInList ?? false,
      placeholder: f.placeholder ?? null,
      defaultValue: f.defaultValue ?? null,
      options: f.options ?? null,
      sort: f.sort ?? i,
    })));
  }
}

// ─── 创建 ─────────────────────────────────────────────────────────────────────
export async function createCmsModel(data: CreateCmsModelInput) {
  const { fields = [], ...model } = data;
  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(cmsModels).values(model).returning();
      await replaceModelFields(tx, created.id, fields);
      return created;
    });
    return getCmsModel(row.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '模型标识已存在');
  }
}

// ─── 更新 ─────────────────────────────────────────────────────────────────────
export async function updateCmsModel(id: number, data: UpdateCmsModelInput) {
  const { fields, ...model } = data;
  try {
    await db.transaction(async (tx) => {
      if (Object.keys(model).length > 0) {
        const [updated] = await tx.update(cmsModels).set(model).where(eq(cmsModels.id, id)).returning();
        if (!updated) throw new HTTPException(404, { message: '内容模型不存在' });
      }
      if (fields) {
        await replaceModelFields(tx, id, fields);
      }
    });
    return getCmsModel(id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '模型标识已存在');
  }
}

// ─── 删除 ─────────────────────────────────────────────────────────────────────
export async function deleteCmsModel(id: number) {
  const row = await ensureCmsModelExists(id);
  if (row.isSystem) throw new HTTPException(400, { message: '系统内置模型不可删除' });
  const [channelCount, contentCount] = await Promise.all([
    db.$count(cmsChannels, eq(cmsChannels.modelId, id)),
    db.$count(cmsContents, eq(cmsContents.modelId, id)),
  ]);
  if (channelCount > 0 || contentCount > 0) {
    throw new HTTPException(400, { message: '该模型已被栏目或内容引用，不可删除' });
  }
  await db.delete(cmsModels).where(eq(cmsModels.id, id));
}
