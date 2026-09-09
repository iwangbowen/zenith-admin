import { and, desc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { CMS_CONTENT_STATUS_LABELS } from '@zenith/shared/cms';
import { db } from '../../../db';
import { cmsChannelUsers, cmsContents, cmsChannels } from '../../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../datetime';
import { assertSiteAccess } from '../../../services/cms/cms-sites.service';
import { getDataScopeCondition } from '../../data-scope';
import { currentUser } from '../../context';
import { isCmsPlatformAdmin } from '../../../services/cms/cms-access';
import { dateRangeConditions, keywordCondition } from '../../where-helpers';
import { asBoolean } from '../query-normalize';
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

function asPositive(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

async function buildWhere(query: Record<string, unknown>): Promise<SQL> {
  const siteId = asPositive(query.siteId);
  if (!siteId) throw new Error('导出内容必须指定站点');
  await assertSiteAccess(siteId);
  const conditions: (SQL | undefined)[] = [eq(cmsContents.siteId, siteId)];
  const user = currentUser();
  if (!isCmsPlatformAdmin(user)) {
    const allowed = await db.select({ channelId: cmsChannelUsers.channelId })
      .from(cmsChannelUsers)
      .where(eq(cmsChannelUsers.userId, user.userId));
    const channelIds = allowed.map((row) => row.channelId);
    conditions.push(channelIds.length > 0 ? inArray(cmsContents.channelId, channelIds) : undefined);
  }
  const deleted = asBoolean(query.deleted) === true;
  conditions.push(deleted ? isNotNull(cmsContents.deletedAt) : isNull(cmsContents.deletedAt));
  if (!deleted) {
    conditions.push(asBoolean(query.archived) === true ? isNotNull(cmsContents.archivedAt) : isNull(cmsContents.archivedAt));
  }
  const channelId = asPositive(query.channelId);
  if (channelId) conditions.push(eq(cmsContents.channelId, channelId));
  const status = typeof query.status === 'string' && query.status in CMS_CONTENT_STATUS_LABELS
    ? query.status as keyof typeof CMS_CONTENT_STATUS_LABELS : undefined;
  if (status) conditions.push(eq(cmsContents.status, status));
  const contentType = typeof query.contentType === 'string' && ['article', 'album', 'media', 'link'].includes(query.contentType)
    ? query.contentType as 'article' | 'album' | 'media' | 'link' : undefined;
  if (contentType) conditions.push(eq(cmsContents.contentType, contentType));
  const isTop = asBoolean(query.isTop);
  const isRecommend = asBoolean(query.isRecommend);
  const isHot = asBoolean(query.isHot);
  if (isTop !== undefined) conditions.push(eq(cmsContents.isTop, isTop));
  if (isRecommend !== undefined) conditions.push(eq(cmsContents.isRecommend, isRecommend));
  if (isHot !== undefined) conditions.push(eq(cmsContents.isHot, isHot));
  conditions.push(keywordCondition(typeof query.keyword === 'string' ? query.keyword : undefined, [cmsContents.title, cmsContents.author]));
  conditions.push(...dateRangeConditions(
    cmsContents.createdAt,
    typeof query.startTime === 'string' ? query.startTime : undefined,
    typeof query.endTime === 'string' ? query.endTime : undefined,
  ));
  const scopeCondition = await getDataScopeCondition({
    currentUserId: user.userId,
    deptColumn: cmsContents.deptId,
    ownerColumn: cmsContents.createdBy,
  });
  conditions.push(scopeCondition);
  return and(...conditions)!;
}

async function loadRows(query: Record<string, unknown>): Promise<CmsContentExportRow[]> {
  const where = await buildWhere(query);
  const rows = await db.select({ content: cmsContents, channelName: cmsChannels.name })
    .from(cmsContents)
    .leftJoin(cmsChannels, and(eq(cmsContents.channelId, cmsChannels.id), eq(cmsChannels.siteId, cmsContents.siteId)))
    .where(where)
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
  permissions: { export: 'cms:content:export' },
  execution: { mode: 'sync', syncMaxRows: 5000, syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => loadRows(query).then((rows) => rows.length),
  streamRows: async (query) => loadRows(query),
});
