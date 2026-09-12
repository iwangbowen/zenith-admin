import { and, desc, eq } from 'drizzle-orm';
import { enumValueOf } from '@zenith/shared/core';
import { CMS_CONTENT_STATUS_LABELS, CMS_CONTENT_STATUSES, CMS_CONTENT_TYPES } from '@zenith/shared/cms';
import { db } from '../../../db';
import { cmsContents, cmsChannels } from '../../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../datetime';
import { cmsContentListColumns } from '../../../services/cms/cms-content-columns';
import { buildCmsContentListWhere, type CmsContentListFilter } from '../../../services/cms/cms-contents-query.service';
import { asBoolean, asPositiveInt, asString } from '../query-normalize';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

interface CmsContentExportRow extends Record<string, unknown> {
  id: number;
  title: string;
  channelName: string;
  author: string;
  source: string;
  statusText: string;
  flags: string;
  viewCount: number;
  publishedAt: string;
  createdAt: string;
}

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'title', header: '标题', width: 40 },
  { key: 'channelName', header: '栏目', width: 16 },
  { key: 'author', header: '作者', width: 12 },
  { key: 'source', header: '来源', width: 12 },
  { key: 'statusText', header: '状态', width: 10 },
  { key: 'flags', header: '属性', width: 14 },
  { key: 'viewCount', header: '浏览量', width: 10, type: 'number' },
  { key: 'publishedAt', header: '发布时间', width: 22, type: 'datetime' },
  { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
];

/** 页面透传的原始 query → 契约筛选类型；访问控制与 where 拼装复用列表 service，不在导出侧另写一份 */
function normalizeQuery(query: Record<string, unknown>): CmsContentListFilter {
  const siteId = asPositiveInt(query.siteId);
  if (!siteId) throw new Error('导出内容必须指定站点');
  return {
    siteId,
    channelId: asPositiveInt(query.channelId),
    status: enumValueOf(CMS_CONTENT_STATUSES, query.status),
    contentType: enumValueOf(CMS_CONTENT_TYPES, query.contentType),
    keyword: asString(query.keyword),
    isTop: asBoolean(query.isTop),
    isRecommend: asBoolean(query.isRecommend),
    isHot: asBoolean(query.isHot),
    deleted: asBoolean(query.deleted),
    archived: asBoolean(query.archived),
    startTime: asString(query.startTime),
    endTime: asString(query.endTime),
  };
}

async function loadRows(query: Record<string, unknown>): Promise<CmsContentExportRow[]> {
  const where = await buildCmsContentListWhere(normalizeQuery(query));
  // 列表投影：不拉正文 / 检索向量 / 附件三个 TOAST 大列
  const rows = await db.select({ ...cmsContentListColumns, channelName: cmsChannels.name })
    .from(cmsContents)
    .leftJoin(cmsChannels, and(eq(cmsContents.channelId, cmsChannels.id), eq(cmsChannels.siteId, cmsContents.siteId)))
    .where(where)
    .orderBy(desc(cmsContents.id))
    .limit(50_000);
  return rows.map((content) => ({
    id: content.id,
    title: content.title,
    channelName: content.channelName ?? '',
    author: content.author ?? '',
    source: content.source ?? '',
    statusText: CMS_CONTENT_STATUS_LABELS[content.status] ?? content.status,
    flags: [content.isTop ? '置顶' : '', content.isRecommend ? '推荐' : '', content.isHot ? '热门' : ''].filter(Boolean).join('/'),
    viewCount: content.viewCount,
    publishedAt: formatNullableDateTime(content.publishedAt) ?? '',
    createdAt: formatDateTime(content.createdAt),
  }));
}

export const cmsContentsExportDefinition = defineExport<Record<string, unknown>, CmsContentExportRow>({
  entity: 'cms.contents',
  moduleName: 'CMS内容管理',
  filenamePrefix: 'CMS内容列表',
  sourcePath: '/cms/contents',
  sheetName: '内容列表',
  formats: ['xlsx', 'csv'],
  permissions: { export: 'cms:content:export' },
  execution: { mode: 'sync', syncMaxRows: 5000, syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => loadRows(query).then((rows) => rows.length),
  streamRows: async (query) => loadRows(query),
});
