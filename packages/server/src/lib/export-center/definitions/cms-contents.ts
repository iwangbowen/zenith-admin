import { and, desc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { enumValueOf } from '@zenith/shared/core';
import { CMS_CONTENT_STATUS_LABELS, CMS_CONTENT_STATUSES, CMS_CONTENT_TYPES } from '@zenith/shared/cms';
import { db } from '../../../db';
import { cmsChannelUsers, cmsContents, cmsChannels } from '../../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../datetime';
import { assertSiteAccess } from '../../../services/cms/cms-sites.service';
import { getDataScopeCondition } from '../../data-scope';
import { currentUser } from '../../context';
import { isCmsPlatformAdmin } from '../../../services/cms/cms-access';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../where-helpers';
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

/** 非平台管理员只能导出自己被授权栏目下的内容；未授权任何栏目时沿用原行为（不加栏目限制） */
async function allowedChannelCondition(userId: number): Promise<SQL | undefined> {
  const allowed = await db.select({ channelId: cmsChannelUsers.channelId })
    .from(cmsChannelUsers)
    .where(eq(cmsChannelUsers.userId, userId));
  const channelIds = allowed.map((row) => row.channelId);
  return channelIds.length > 0 ? inArray(cmsContents.channelId, channelIds) : undefined;
}

async function buildContentWhere(query: Record<string, unknown>): Promise<SQL> {
  const siteId = asPositive(query.siteId);
  if (!siteId) throw new Error('导出内容必须指定站点');
  await assertSiteAccess(siteId);
  const user = currentUser();
  const channelScope = isCmsPlatformAdmin(user) ? undefined : await allowedChannelCondition(user.userId);
  const deleted = asBoolean(query.deleted) === true;
  const channelId = asPositive(query.channelId);
  const status = enumValueOf(CMS_CONTENT_STATUSES, query.status);
  const contentType = enumValueOf(CMS_CONTENT_TYPES, query.contentType);
  const isTop = asBoolean(query.isTop);
  const isRecommend = asBoolean(query.isRecommend);
  const isHot = asBoolean(query.isHot);
  const scopeCondition = await getDataScopeCondition({
    currentUserId: user.userId,
    deptColumn: cmsContents.deptId,
    ownerColumn: cmsContents.createdBy,
  });
  return buildWhere(
    eq(cmsContents.siteId, siteId),
    channelScope,
    deleted ? isNotNull(cmsContents.deletedAt) : isNull(cmsContents.deletedAt),
    deleted
      ? undefined
      : (asBoolean(query.archived) === true ? isNotNull(cmsContents.archivedAt) : isNull(cmsContents.archivedAt)),
    channelId ? eq(cmsContents.channelId, channelId) : undefined,
    status ? eq(cmsContents.status, status) : undefined,
    contentType ? eq(cmsContents.contentType, contentType) : undefined,
    isTop === undefined ? undefined : eq(cmsContents.isTop, isTop),
    isRecommend === undefined ? undefined : eq(cmsContents.isRecommend, isRecommend),
    isHot === undefined ? undefined : eq(cmsContents.isHot, isHot),
    keywordCondition(typeof query.keyword === 'string' ? query.keyword : undefined, [cmsContents.title, cmsContents.author]),
    ...dateRangeConditions(
      cmsContents.createdAt,
      typeof query.startTime === 'string' ? query.startTime : undefined,
      typeof query.endTime === 'string' ? query.endTime : undefined,
    ),
    scopeCondition,
  )!;
}

async function loadRows(query: Record<string, unknown>): Promise<CmsContentExportRow[]> {
  const where = await buildContentWhere(query);
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
