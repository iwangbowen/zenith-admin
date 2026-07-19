import { and, desc, eq, isNull, like, or, type SQL } from 'drizzle-orm';
import { CMS_CONTENT_STATUS_LABELS } from '@zenith/shared';
import { db } from '../../../db';
import { cmsContents, cmsChannels } from '../../../db/schema';
import { escapeLike } from '../../where-helpers';
import { formatDateTime, formatNullableDateTime } from '../../datetime';
import { assertSiteAccess } from '../../../services/cms/cms-sites.service';
import { defineExport } from '../registry';
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

function asPositive(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

async function loadRows(query: Record<string, unknown>): Promise<CmsContentExportRow[]> {
  const siteId = asPositive(query.siteId);
  if (!siteId) return [];
  await assertSiteAccess(siteId);
  const conditions: SQL[] = [eq(cmsContents.siteId, siteId), isNull(cmsContents.deletedAt)];
  const channelId = asPositive(query.channelId);
  if (channelId) conditions.push(eq(cmsContents.channelId, channelId));
  const status = typeof query.status === 'string' && query.status in CMS_CONTENT_STATUS_LABELS
    ? query.status as keyof typeof CMS_CONTENT_STATUS_LABELS : undefined;
  if (status) conditions.push(eq(cmsContents.status, status));
  if (typeof query.keyword === 'string' && query.keyword.trim()) {
    const kw = or(
      like(cmsContents.title, `%${escapeLike(query.keyword.trim())}%`),
      like(cmsContents.author, `%${escapeLike(query.keyword.trim())}%`),
    );
    if (kw) conditions.push(kw);
  }
  const rows = await db.select({ content: cmsContents, channelName: cmsChannels.name })
    .from(cmsContents)
    .leftJoin(cmsChannels, eq(cmsContents.channelId, cmsChannels.id))
    .where(and(...conditions))
    .orderBy(desc(cmsContents.id))
    .limit(50_000);
  return rows.map(({ content, channelName }) => ({
    id: content.id,
    title: content.title,
    channelName: channelName ?? '',
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
  permissions: { export: 'cms:content:list' },
  execution: { mode: 'sync', syncMaxRows: 5000, syncModeOverridesAsyncPolicies: true },
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async (query) => loadRows(query).then((rows) => rows.length),
  streamRows: async (query) => loadRows(query),
});
