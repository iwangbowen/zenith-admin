import { requireFirstRow } from '../../lib/db-assert';
import { listRows } from '../../lib/list-query';
import type { QueryOutputOf } from '@zenith/shared/core';
import { eq, asc, and } from 'drizzle-orm';
import { cmsTagContract, cmsTagSchema } from '@zenith/shared/cms';
import { db } from '../../db';
import { cmsTags } from '../../db/schema';
import type { CmsTagRow } from '../../db/schema';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { refreshCmsPublicConfiguration } from './cms-public-config-refresh.service';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export const mapCmsTag = entityMapper(cmsTagSchema);

// ─── 前置校验 ─────────────────────────────────────────────────────────────────
export async function ensureCmsTagExists(id: number): Promise<CmsTagRow> {
  return requireFirstRow(db.select().from(cmsTags).where(eq(cmsTags.id, id)).limit(1), '标签不存在');
}

export async function getCmsTag(id: number) {
  const row = await ensureCmsTagExists(id);
  await assertSiteAccess(row.siteId);
  return mapCmsTag(row);
}

// ─── 列表 ─────────────────────────────────────────────────────────────────────
export async function listCmsTags(q: QueryOutputOf<typeof cmsTagContract.list>) {
  await ensureCmsSiteExists(q.siteId);
  await assertSiteAccess(q.siteId);
  const where = buildWhere(
    eq(cmsTags.siteId, q.siteId),
    keywordCondition(q.keyword, [cmsTags.name, cmsTags.slug]),
    keywordCondition(q.groupName, [cmsTags.groupName]),
  );
  return listRows({
    page: q.page,
    pageSize: q.pageSize,
    table: cmsTags,
    where,
    orderBy: [asc(cmsTags.id)],
    map: mapCmsTag,
  });
}

/** 站点全部标签（内容编辑打标下拉用） */
export async function listAllCmsTags(siteId: number) {
  await ensureCmsSiteExists(siteId);
  await assertSiteAccess(siteId);
  const rows = await db.select().from(cmsTags).where(and(
    eq(cmsTags.siteId, siteId),
  )).orderBy(asc(cmsTags.id));
  return rows.map(mapCmsTag);
}

// ─── 创建 / 更新 / 删除 ────────────────────────────────────────────────────────
export const cmsTagService = defineCrudService(cmsTagContract, {
  table: cmsTags,
  map: mapCmsTag,
  notFound: '标签不存在',
  unique: '同站点下标签名称或标识已存在',
  list: (q) => ({
    where: [
      eq(cmsTags.siteId, q.siteId),
      keywordCondition(q.keyword, [cmsTags.name, cmsTags.slug]),
      keywordCondition(q.groupName, [cmsTags.groupName]),
    ],
    orderBy: [asc(cmsTags.id)],
  }),
  create: {
    before: async (data) => {
      await ensureCmsSiteExists(data.siteId);
      await assertSiteAccess(data.siteId);
    },
    after: async (_entity, row) => refreshCmsPublicConfiguration(row.siteId, '标签创建', `tag:${row.id}:${row.updatedAt.getTime()}`),
  },
  update: {
    before: async (_data, current) => {
      await assertSiteAccess(current.siteId);
    },
    after: async (_entity, row) => refreshCmsPublicConfiguration(row.siteId, '标签更新', `tag:${row.id}:${row.updatedAt.getTime()}`),
  },
  remove: {
    before: async (current) => {
      await assertSiteAccess(current.siteId);
    },
    after: async (current) => refreshCmsPublicConfiguration(current.siteId, '标签删除', `tag:${current.id}:deleted:${Date.now()}`),
  },
});

export const {
  create: createCmsTag,
  update: updateCmsTag,
  remove: deleteCmsTag,
} = cmsTagService;
