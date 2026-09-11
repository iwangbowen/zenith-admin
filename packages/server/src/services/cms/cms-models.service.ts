import { requireRow } from '../../lib/db-assert';
import type { QueryOutputOf } from '@zenith/shared/core';
import { buildListResult } from '../../lib/list-query';
import { eq, asc, and, or, inArray, isNull, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { cmsModelContract } from '@zenith/shared/cms';
import { db } from '../../db';
import { cmsModels, cmsModelFields, cmsChannels, cmsContents, cmsSites, dicts, dictItems } from '../../db/schema';
import type { CmsModelRow, CmsModelFieldRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { CreateCmsModelInput, UpdateCmsModelInput, CmsModelFieldInput } from '@zenith/shared/cms';
import { assertSiteAccess } from './cms-sites.service';
import { acquireCmsGlobalThemeLifecycleLock, lockCmsSiteForMutation } from './cms-site-publish-lock.service';
import { enqueueCmsPublishOutboxes, insertCmsSiteRefsRebuildOutbox } from './cms-publish-outbox.service';
import { isCmsPlatformAdmin } from './cms-access';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

/**
 * 批量解析字段的最终选项。
 *
 * 字典来源的字段在这里一次性查回所有引用到的字典项（按 dictCode 分组），
 * 避免逐字段查询造成 N+1；解析结果统一放进 `resolvedOptions`，
 * 前端表单只消费该字段，不必各自判断来源。
 */
export async function resolveCmsModelFieldOptions(
  rows: readonly CmsModelFieldRow[],
): Promise<Map<number, { label: string; value: string }[]>> {
  const resolved = new Map<number, { label: string; value: string }[]>();
  const dictCodes = [...new Set(rows
    .filter((r) => r.optionSource === 'dict' && r.dictCode?.trim())
    .map((r) => r.dictCode!.trim()))];

  const byCode = new Map<string, { label: string; value: string }[]>();
  if (dictCodes.length > 0) {
    const items = await db.select({
      code: dicts.code,
      label: dictItems.label,
      value: dictItems.value,
      sort: dictItems.sort,
      id: dictItems.id,
    })
      .from(dictItems)
      .innerJoin(dicts, eq(dictItems.dictId, dicts.id))
      .where(and(
        inArray(dicts.code, dictCodes),
        eq(dicts.status, 'enabled'),
        eq(dictItems.status, 'enabled'),
      ))
      .orderBy(asc(dictItems.sort), asc(dictItems.id));
    for (const item of items) {
      const list = byCode.get(item.code) ?? [];
      list.push({ label: item.label, value: item.value });
      byCode.set(item.code, list);
    }
  }

  for (const row of rows) {
    resolved.set(row.id, row.optionSource === 'dict'
      // 字典被删/停用时给空数组而不是回落手工选项：静默回落会让运营以为配置仍生效
      ? (byCode.get(row.dictCode?.trim() ?? '') ?? [])
      : (row.options ?? []));
  }
  return resolved;
}

export function mapCmsModelField(row: CmsModelFieldRow, resolvedOptions?: { label: string; value: string }[]) {
  return {
    id: row.id,
    modelId: row.modelId,
    name: row.name,
    label: row.label,
    fieldType: row.fieldType,
    required: row.required,
    searchable: row.searchable,
    showInList: row.showInList,
    showInDetail: row.showInDetail,
    detailGroup: row.detailGroup ?? null,
    detailSort: row.detailSort,
    placeholder: row.placeholder ?? null,
    defaultValue: row.defaultValue ?? null,
    optionSource: row.optionSource,
    dictCode: row.dictCode ?? null,
    options: row.options ?? null,
    ...(resolvedOptions ? { resolvedOptions } : {}),
    sort: row.sort,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 带选项解析的字段映射（前端动态表单入口统一走这里） */
export async function mapCmsModelFieldsResolved(rows: readonly CmsModelFieldRow[]) {
  const resolved = await resolveCmsModelFieldOptions(rows);
  return rows.map((row) => mapCmsModelField(row, resolved.get(row.id) ?? []));
}

export function mapCmsModel(row: CmsModelRow, fields?: CmsModelFieldRow[], ownerSiteName?: string | null) {
  return {
    id: row.id,
    ownerSiteId: row.ownerSiteId ?? null,
    ownerSiteName: ownerSiteName ?? null,
    name: row.name,
    code: row.code,
    description: row.description ?? null,
    isSystem: row.isSystem,
    status: row.status,
    sort: row.sort,
    ...(fields ? { fields: fields.map((field) => mapCmsModelField(field)) } : {}),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsModelExists(id: number): Promise<CmsModelRow> {
  const [row] = await db.select().from(cmsModels).where(eq(cmsModels.id, id)).limit(1);
  return requireRow(row, '内容模型不存在');
}

/**
 * Resolve the caller's model scope.
 *
 * A site-scoped request must prove access to that site before any model query
 * is made.  Only a platform administrator may intentionally omit the scope;
 * this is the sole global view used by administration tooling.
 */
async function resolveCmsModelScope(siteId?: number): Promise<number | null> {
  if (siteId == null) {
    if (!isCmsPlatformAdmin()) {
      throw new HTTPException(400, { message: '普通请求必须指定站点范围' });
    }
    return null;
  }
  await assertSiteAccess(siteId);
  return siteId;
}

/**
 * Load a model only when it is visible in the requested site scope.
 * A wrong-site model is reported as 404 so its existence and metadata cannot
 * be probed by a user who can access another site.
 */
async function ensureCmsModelReadable(id: number, siteId?: number): Promise<CmsModelRow> {
  const row = await ensureCmsModelExists(id);
  const scope = await resolveCmsModelScope(siteId);
  if (scope != null && row.ownerSiteId != null && row.ownerSiteId !== scope) {
    throw new HTTPException(404, { message: '内容模型不存在' });
  }
  return row;
}

/** Mutation policy: shared models affect every site and are platform-owned. */
async function ensureCmsModelMutable(id: number, siteId?: number): Promise<CmsModelRow> {
  const row = await ensureCmsModelReadable(id, siteId);
  if (row.ownerSiteId == null && !isCmsPlatformAdmin()) {
    throw new HTTPException(403, { message: '平台共享模型仅平台管理员可修改' });
  }
  return row;
}

export async function getCmsModel(id: number, siteId?: number) {
  await ensureCmsModelReadable(id, siteId);
  const row = await db.query.cmsModels.findFirst({
    where: eq(cmsModels.id, id),
    with: { fields: { orderBy: [asc(cmsModelFields.sort), asc(cmsModelFields.id)] } },
  });
  const model = requireRow(row, '内容模型不存在');
  return { ...mapCmsModel(model), fields: await mapCmsModelFieldsResolved(model.fields) };
}

/** 获取模型的字段定义（内容编辑动态表单/检索索引用） */
export async function listCmsModelFields(modelId: number, siteId?: number): Promise<CmsModelFieldRow[]> {
  const row = await ensureCmsModelExists(modelId);
  if (siteId != null) {
    await assertSiteAccess(siteId);
    if (row.ownerSiteId != null && row.ownerSiteId !== siteId) {
      throw new HTTPException(404, { message: '内容模型不存在' });
    }
  } else if (row.ownerSiteId != null) {
    // Existing server-side render/validation callers do not carry a site id;
    // derive it from the immutable owner and still enforce the ACL.
    await assertSiteAccess(row.ownerSiteId);
  }
  return db.select().from(cmsModelFields)
    .where(eq(cmsModelFields.modelId, modelId))
    .orderBy(asc(cmsModelFields.sort), asc(cmsModelFields.id));
}

// ─── 列表 ─────────────────────────────────────────────────────────────────────
/** 站点可见性条件：平台共享（owner 为空）或归属该站点 */
function modelVisibilityCondition(siteId?: number): SQL | undefined {
  if (siteId == null) return undefined;
  return or(isNull(cmsModels.ownerSiteId), eq(cmsModels.ownerSiteId, siteId));
}

/** 模型被栏目 / 内容 / 站点扩展引用的 WHERE；`scope` 为站点范围（平台管理员传 `null` 表示全部站点） */
function cmsModelRefWheres(id: number, scope: number | null | undefined) {
  return {
    channelWhere: buildWhere(eq(cmsChannels.modelId, id), scope == null ? undefined : eq(cmsChannels.siteId, scope)),
    contentWhere: buildWhere(eq(cmsContents.modelId, id), scope == null ? undefined : eq(cmsContents.siteId, scope)),
    siteWhere: buildWhere(eq(cmsSites.modelId, id), scope == null ? undefined : eq(cmsSites.id, scope)),
  };
}

export async function listCmsModels(q: QueryOutputOf<typeof cmsModelContract.list>) {
  const { keyword = '', status, siteId, page, pageSize } = q;
  const scope = await resolveCmsModelScope(siteId);
  const where = buildWhere(
    keywordCondition(keyword, [cmsModels.name, cmsModels.code]),
    status ? eq(cmsModels.status, status) : undefined,
    modelVisibilityCondition(scope ?? undefined),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(cmsModels, where),
    rows: async () => {
      const rows = await withPagination(
        db.select({ model: cmsModels, ownerSiteName: cmsSites.name })
          .from(cmsModels)
          .leftJoin(cmsSites, eq(cmsModels.ownerSiteId, cmsSites.id))
          .where(where)
          .orderBy(asc(cmsModels.sort), asc(cmsModels.id))
          .$dynamic(),
        page,
        pageSize,
      );
      // 附带字段列表（模型数量有限，一次查回避免 N+1）
      const ids = rows.map((r) => r.model.id);
      const fields = ids.length > 0
        ? await db.select().from(cmsModelFields).where(inArray(cmsModelFields.modelId, ids)).orderBy(asc(cmsModelFields.sort), asc(cmsModelFields.id))
        : [];
      const fieldMap = new Map<number, CmsModelFieldRow[]>();
      for (const f of fields) {
        const arr = fieldMap.get(f.modelId) ?? [];
        arr.push(f);
        fieldMap.set(f.modelId, arr);
      }
      return rows.map((r) => mapCmsModel(r.model, fieldMap.get(r.model.id) ?? [], r.ownerSiteName));
    },
  });
}

/** 全部启用模型（栏目绑定下拉用） */
/**
 * 全部启用模型（含字段与解析后的选项）。
 *
 * 内容编辑页的模型字段动态表单直接消费本接口的 `fields`，因此必须带字段；
 * 选项在此一次性解析（字典来源查库展开），前端无需二次请求。
 * `siteId` 提供时按站群可见性过滤（平台共享 + 该站点专属）。
 */
export async function listAllCmsModels(siteId?: number) {
  const scope = await resolveCmsModelScope(siteId);
  const rows = await db.query.cmsModels.findMany({
    where: buildWhere(eq(cmsModels.status, 'enabled'), modelVisibilityCondition(scope ?? undefined)),
    orderBy: [asc(cmsModels.sort), asc(cmsModels.id)],
    with: { fields: { orderBy: [asc(cmsModelFields.sort), asc(cmsModelFields.id)] } },
  });
  const allFields = rows.flatMap((row) => row.fields);
  const resolved = await resolveCmsModelFieldOptions(allFields);
  return rows.map((row) => ({
    ...mapCmsModel(row),
    fields: row.fields.map((field) => mapCmsModelField(field, resolved.get(field.id) ?? [])),
  }));
}

/**
 * 断言模型对站点可用（栏目绑定/站点扩展模型校验）：
 * 平台共享模型全站可用；专属模型仅归属站点可绑定。
 */
export async function assertCmsModelUsableBySite(modelId: number, siteId: number): Promise<void> {
  await assertSiteAccess(siteId);
  const row = await ensureCmsModelExists(modelId);
  if (row.ownerSiteId != null && row.ownerSiteId !== siteId) {
    throw new HTTPException(400, { message: `模型「${row.name}」归属其他站点，当前站点不可绑定` });
  }
}

/** 模型引用统计：被哪些栏目绑定、多少内容/站点扩展在使用（删除阻断明细与「使用中」列） */
export async function getCmsModelRefs(id: number, siteId?: number) {
  const scope = await resolveCmsModelScope(siteId);
  await ensureCmsModelReadable(id, scope ?? undefined);
  const { channelWhere, contentWhere, siteWhere } = cmsModelRefWheres(id, scope);
  const [channels, contentCount, siteExtendCount] = await Promise.all([
    db.select({
      id: cmsChannels.id,
      siteId: cmsChannels.siteId,
      siteName: cmsSites.name,
      name: cmsChannels.name,
    }).from(cmsChannels)
      .innerJoin(cmsSites, eq(cmsChannels.siteId, cmsSites.id))
      .where(channelWhere)
      .orderBy(asc(cmsChannels.siteId), asc(cmsChannels.id)),
    db.$count(cmsContents, contentWhere),
    db.$count(cmsSites, siteWhere),
  ]);
  return {
    channels: channels.map((ch) => ({ id: ch.id, siteId: ch.siteId, siteName: ch.siteName, name: ch.name })),
    contentCount,
    siteExtendCount,
  };
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
      showInDetail: f.showInDetail ?? false,
      detailGroup: f.detailGroup ?? null,
      detailSort: f.detailSort ?? 0,
      placeholder: f.placeholder ?? null,
      defaultValue: f.defaultValue ?? null,
      optionSource: f.optionSource ?? 'manual',
      // 手动来源时清空 dictCode，避免切换来源后残留脏引用
      dictCode: f.optionSource === 'dict' ? (f.dictCode ?? null) : null,
      options: f.options ?? null,
      sort: f.sort ?? i,
    })));
  }
}

async function listCmsModelReferenceSiteIds(executor: DbExecutor, _modelId: number, ownerSiteId: number | null): Promise<number[]> {
  // Shared model definitions can be referenced by any site, including through
  // inherited template settings. Site-owned models are confined to their owner.
  if (ownerSiteId != null) return [ownerSiteId];
  const allSites = await executor.select({ siteId: cmsSites.id }).from(cmsSites);
  return allSites.map((row) => row.siteId).sort((a, b) => a - b);
}

// ─── 创建 ─────────────────────────────────────────────────────────────────────
export async function createCmsModel(data: CreateCmsModelInput) {
  const { fields = [], ...model } = data;
  // Shared models affect every site and therefore can only be created by a
  // platform administrator.
  if (model.ownerSiteId == null && !isCmsPlatformAdmin()) {
    throw new HTTPException(403, { message: '平台共享模型仅平台管理员可创建' });
  }
  // Site-owned models require an explicit site ACL before insertion.
  if (model.ownerSiteId != null) {
    await assertSiteAccess(model.ownerSiteId);
  }
  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(cmsModels).values(model).returning();
      await replaceModelFields(tx, created.id, fields);
      return created;
    });
    return getCmsModel(row.id, row.ownerSiteId ?? undefined);
  } catch (err) {
    rethrowPgUniqueViolation(err, '模型标识已存在');
  }
}

// ─── 更新 ─────────────────────────────────────────────────────────────────────
export async function updateCmsModel(id: number, data: UpdateCmsModelInput, siteId?: number) {
  const current = await ensureCmsModelMutable(id, siteId);
  // Keep the service boundary defensive for internal callers that bypass the
  // shared Zod schema (which omits ownerSiteId from updates).
  if (Object.prototype.hasOwnProperty.call(data, 'ownerSiteId')) {
    throw new HTTPException(400, { message: '模型归属站点创建后不可变更' });
  }
  const { fields, ...model } = data;
  try {
    const tasks = await db.transaction(async (tx) => {
      await acquireCmsGlobalThemeLifecycleLock(tx);
      const referenceSiteIds = await listCmsModelReferenceSiteIds(tx, id, current.ownerSiteId);
      // Site locks precede the model row lock. Channel/content writes use the
      // same order, preventing a model update from deadlocking with a publish.
      for (const referencedSiteId of referenceSiteIds) {
        await lockCmsSiteForMutation(tx, referencedSiteId);
      }
      const [locked] = await tx.select().from(cmsModels)
        .where(eq(cmsModels.id, id)).for('update').limit(1);
      requireRow(locked, '内容模型不存在');
      if (locked.ownerSiteId !== current.ownerSiteId) {
        throw new HTTPException(409, { message: '内容模型归属已发生变化，请重试' });
      }
      if (Object.keys(model).length > 0) {
        const [updated] = await tx.update(cmsModels).set(model).where(eq(cmsModels.id, id)).returning();
        requireRow(updated, '内容模型不存在');
      }
      if (fields) {
        await replaceModelFields(tx, id, fields);
      }
      const rebuilds = [];
      for (const referencedSiteId of referenceSiteIds) {
        const [site] = await tx.select().from(cmsSites)
          .where(eq(cmsSites.id, referencedSiteId)).limit(1);
        if (!site) continue;
        rebuilds.push(await insertCmsSiteRefsRebuildOutbox(
          tx,
          site,
          '内容模型字段更新',
          'site:' + referencedSiteId + ':model:' + id + ':' + randomUUID(),
        ));
      }
      return rebuilds;
    });
    await enqueueCmsPublishOutboxes(tasks, '内容模型 #' + id + ' 更新');
    return getCmsModel(id, siteId);
  } catch (err) {
    rethrowPgUniqueViolation(err, '模型标识已存在');
  }
}

// ─── 删除 ─────────────────────────────────────────────────────────────────────
export async function deleteCmsModel(id: number, siteId?: number) {
  const row = await ensureCmsModelMutable(id, siteId);
  if (row.isSystem) throw new HTTPException(400, { message: '系统内置模型不可删除' });
  // Shared models are global resources even when the UI opened them from a
  // site-scoped view; deletion must account for references on every site.
  const scope = row.ownerSiteId == null ? null : siteId;
  await db.transaction(async (tx) => {
    await acquireCmsGlobalThemeLifecycleLock(tx);
    const referenceSiteIds = await listCmsModelReferenceSiteIds(tx, id, row.ownerSiteId);
    for (const referencedSiteId of referenceSiteIds) {
      await lockCmsSiteForMutation(tx, referencedSiteId);
    }
    const [locked] = await tx.select().from(cmsModels)
      .where(eq(cmsModels.id, id)).for('update').limit(1);
    requireRow(locked, '内容模型不存在');
    if (locked.ownerSiteId !== row.ownerSiteId) {
      throw new HTTPException(409, { message: '内容模型归属已发生变化，请重试' });
    }
    if (locked.isSystem) throw new HTTPException(400, { message: '系统内置模型不可删除' });
    const { channelWhere, contentWhere, siteWhere } = cmsModelRefWheres(id, scope);
    const [channelCount, contentCount, siteExtendCount] = await Promise.all([
      tx.$count(cmsChannels, channelWhere),
      tx.$count(cmsContents, contentWhere),
      tx.$count(cmsSites, siteWhere),
    ]);
    if (channelCount > 0 || contentCount > 0 || siteExtendCount > 0) {
      throw new HTTPException(400, { message: '该模型已被栏目、内容或站点扩展引用，不可删除' });
    }
    await tx.delete(cmsModels).where(eq(cmsModels.id, id));
  });
}
