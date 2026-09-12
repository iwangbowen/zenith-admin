import { desc, eq, sql, type SQL } from 'drizzle-orm';
import { enumValueOf } from '@zenith/shared/core';
import {
  CMS_PUBLISH_ARTIFACT_STATUS_LABELS,
  CMS_PUBLISH_ARTIFACT_STATUSES,
  CMS_PUBLISH_TARGET_TYPE_LABELS,
  CMS_PUBLISH_TARGET_TYPES,
} from '@zenith/shared/cms';
import { db } from '../../../db';
import { asyncTasks, cmsPublishArtifacts } from '../../../db/schema';
import { formatDateTime, formatNullableDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../datetime';
import { buildWhere, keywordCondition } from '../../where-helpers';
import { asyncTaskStatusCondition } from '../../task-center/status-filter';
import { buildCmsPublishingWhere } from '../../../services/cms/cms-publishing.service';
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

async function buildArtifactWhere(query: Record<string, unknown>): Promise<SQL | undefined> {
  const siteId = Number(query.siteId);
  const taskId = Number(query.taskId);
  const targetType = enumValueOf(CMS_PUBLISH_TARGET_TYPES, query.targetType);
  const status = enumValueOf(CMS_PUBLISH_ARTIFACT_STATUSES, query.status);
  const taskWhere = await buildCmsPublishingWhere({
    siteId: Number.isInteger(siteId) && siteId > 0 ? siteId : undefined,
  });
  const start = parseDateRangeStart(typeof query.startTime === 'string' ? query.startTime : undefined);
  const end = parseDateRangeEnd(typeof query.endTime === 'string' ? query.endTime : undefined);
  const artifactTime = sql`coalesce(${cmsPublishArtifacts.generatedAt}, ${cmsPublishArtifacts.updatedAt})`;
  return buildWhere(
    taskWhere,
    eq(cmsPublishArtifacts.taskId, asyncTasks.id),
    asyncTaskStatusCondition(query.taskStatus),
    Number.isInteger(taskId) && taskId > 0 ? eq(cmsPublishArtifacts.taskId, taskId) : undefined,
    targetType ? eq(cmsPublishArtifacts.targetType, targetType) : undefined,
    status ? eq(cmsPublishArtifacts.status, status) : undefined,
    start ? sql`${artifactTime} >= ${start}` : undefined,
    end ? sql`${artifactTime} <= ${end}` : undefined,
    typeof query.keyword === 'string' ? keywordCondition(query.keyword, [cmsPublishArtifacts.path], 'ilike') : undefined,
  );
}

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
