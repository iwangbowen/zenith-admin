import { and, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import {
  CMS_PUBLISH_ARTIFACT_STATUS_LABELS,
  CMS_PUBLISH_TARGET_TYPE_LABELS,
} from '@zenith/shared';
import { db } from '../../../db';
import { asyncTasks, cmsPublishArtifacts } from '../../../db/schema';
import { formatDateTime, formatNullableDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../datetime';
import { escapeLike } from '../../where-helpers';
import { buildCmsPublishingConditions } from '../../../services/cms/cms-publishing.service';
import { defineExport } from '../registry';
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

async function conditions(query: Record<string, unknown>): Promise<SQL[]> {
  const siteId = Number(query.siteId);
  const taskId = Number(query.taskId);
  const targetType = typeof query.targetType === 'string' && query.targetType in CMS_PUBLISH_TARGET_TYPE_LABELS
    ? query.targetType as keyof typeof CMS_PUBLISH_TARGET_TYPE_LABELS
    : undefined;
  const status = typeof query.status === 'string' && query.status in CMS_PUBLISH_ARTIFACT_STATUS_LABELS
    ? query.status as keyof typeof CMS_PUBLISH_ARTIFACT_STATUS_LABELS
    : undefined;
  const taskConditions = await buildCmsPublishingConditions({
    siteId: Number.isInteger(siteId) && siteId > 0 ? siteId : undefined,
  });
  const result: SQL[] = [...taskConditions, eq(cmsPublishArtifacts.taskId, asyncTasks.id)];
  if (Number.isInteger(taskId) && taskId > 0) result.push(eq(cmsPublishArtifacts.taskId, taskId));
  if (targetType) result.push(eq(cmsPublishArtifacts.targetType, targetType));
  if (status) result.push(eq(cmsPublishArtifacts.status, status));
  const start = parseDateRangeStart(typeof query.startTime === 'string' ? query.startTime : undefined);
  const end = parseDateRangeEnd(typeof query.endTime === 'string' ? query.endTime : undefined);
  const artifactTime = sql`coalesce(${cmsPublishArtifacts.generatedAt}, ${cmsPublishArtifacts.updatedAt})`;
  if (start) result.push(sql`${artifactTime} >= ${start}`);
  if (end) result.push(sql`${artifactTime} <= ${end}`);
  if (typeof query.keyword === 'string' && query.keyword.trim()) {
    const keyword = `%${escapeLike(query.keyword.trim())}%`;
    result.push(ilike(cmsPublishArtifacts.path, keyword));
  }
  return result;
}

async function loadRows(query: Record<string, unknown>): Promise<PublishArtifactExportRow[]> {
  const rows = await db.select({ artifact: cmsPublishArtifacts }).from(cmsPublishArtifacts)
    .innerJoin(asyncTasks, eq(cmsPublishArtifacts.taskId, asyncTasks.id))
    .where(and(...await conditions(query)))
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
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async (query) => {
    const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(cmsPublishArtifacts)
      .innerJoin(asyncTasks, eq(cmsPublishArtifacts.taskId, asyncTasks.id))
      .where(and(...await conditions(query)));
    return row?.total ?? 0;
  },
  streamRows: async (query) => loadRows(query),
});
