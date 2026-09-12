import { desc, eq, sql } from 'drizzle-orm';
import { enumValueOf } from '@zenith/shared/core';
import {
  CMS_PUBLISH_ARTIFACT_STATUS_LABELS,
  CMS_PUBLISH_ARTIFACT_STATUSES,
  CMS_PUBLISH_TARGET_TYPE_LABELS,
  CMS_PUBLISH_TARGET_TYPES,
} from '@zenith/shared/cms';
import { db } from '../../../db';
import { asyncTasks, cmsPublishArtifacts } from '../../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../datetime';
import { buildCmsPublishArtifactsWhere, type CmsPublishArtifactListFilter } from '../../../services/cms/cms-publishing.service';
import { asPositiveInt, asString } from '../query-normalize';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

interface PublishArtifactExportRow extends Record<string, unknown> {
  taskId: number;
  siteId: number;
  targetType: string;
  path: string;
  url: string;
  status: string;
  checksum: string;
  size: number | null;
  error: string;
  generatedAt: string;
  createdAt: string;
}

const columns: ExportColumn<PublishArtifactExportRow>[] = [
  { key: 'taskId', header: '任务 ID', width: 12, type: 'number' },
  { key: 'siteId', header: '站点 ID', width: 12, type: 'number' },
  { key: 'targetType', header: '目标类型', width: 16 },
  { key: 'path', header: '产物路径', width: 44 },
  { key: 'url', header: '访问 URL', width: 48 },
  { key: 'status', header: '状态', width: 12 },
  { key: 'checksum', header: 'SHA-256', width: 68 },
  { key: 'size', header: '大小（字节）', width: 16, type: 'number' },
  { key: 'error', header: '错误', width: 40 },
  { key: 'generatedAt', header: '生成时间', width: 22, type: 'datetime' },
  { key: 'createdAt', header: '记录时间', width: 22, type: 'datetime' },
];

/** 页面透传的原始 query → 契约筛选类型；where 复用产物列表 service（关键字同列表匹配 path / url / error） */
function normalizeQuery(query: Record<string, unknown>): CmsPublishArtifactListFilter & { taskStatus?: string } {
  return {
    siteId: asPositiveInt(query.siteId),
    taskId: asPositiveInt(query.taskId),
    targetType: enumValueOf(CMS_PUBLISH_TARGET_TYPES, query.targetType),
    status: enumValueOf(CMS_PUBLISH_ARTIFACT_STATUSES, query.status),
    startTime: asString(query.startTime),
    endTime: asString(query.endTime),
    keyword: asString(query.keyword),
    taskStatus: asString(query.taskStatus),
  };
}

const buildArtifactWhere = (query: Record<string, unknown>) => buildCmsPublishArtifactsWhere(normalizeQuery(query));

async function loadRows(query: Record<string, unknown>): Promise<PublishArtifactExportRow[]> {
  const rows = await db.select({ artifact: cmsPublishArtifacts }).from(cmsPublishArtifacts)
    .innerJoin(asyncTasks, eq(cmsPublishArtifacts.taskId, asyncTasks.id))
    .where(await buildArtifactWhere(query))
    .orderBy(desc(cmsPublishArtifacts.id))
    .limit(50_000);
  return rows.map(({ artifact }) => ({
    taskId: artifact.taskId,
    siteId: artifact.siteId,
    targetType: CMS_PUBLISH_TARGET_TYPE_LABELS[artifact.targetType],
    path: artifact.path,
    url: artifact.url ?? '',
    status: CMS_PUBLISH_ARTIFACT_STATUS_LABELS[artifact.status],
    checksum: artifact.checksum ?? '',
    size: artifact.size ?? null,
    error: artifact.error ?? '',
    generatedAt: formatNullableDateTime(artifact.generatedAt) ?? '',
    createdAt: formatDateTime(artifact.createdAt),
  }));
}

export const cmsPublishArtifactsExportDefinition = defineExport<Record<string, unknown>, PublishArtifactExportRow>({
  entity: 'cms.publish-artifacts',
  moduleName: 'CMS发布中心',
  filenamePrefix: 'CMS发布产物',
  sourcePath: '/cms/publishing',
  sheetName: '发布产物',
  formats: ['xlsx', 'csv'],
  permissions: { export: 'cms:publish:view' },
  execution: { mode: 'sync', syncMaxRows: 5000, syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => {
    const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(cmsPublishArtifacts)
      .innerJoin(asyncTasks, eq(cmsPublishArtifacts.taskId, asyncTasks.id))
      .where(await buildArtifactWhere(query));
    return row?.total ?? 0;
  },
  streamRows: async (query) => loadRows(query),
});
