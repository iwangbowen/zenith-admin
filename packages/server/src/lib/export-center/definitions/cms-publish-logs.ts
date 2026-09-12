import { desc, eq, sql, type SQL } from 'drizzle-orm';
import { enumValueOf } from '@zenith/shared/core';
import { ASYNC_TASK_ITEM_STATUSES } from '@zenith/shared/tasks';
import { db } from '../../../db';
import { asyncTaskItems, asyncTasks } from '../../../db/schema';
import { formatDateTime } from '../../datetime';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../where-helpers';
import { asyncTaskStatusCondition } from '../../task-center/status-filter';
import { buildCmsPublishingWhere } from '../../../services/cms/cms-publishing.service';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

interface PublishLogExportRow extends Record<string, unknown> {
  taskId: number;
  taskTitle: string;
  itemKey: string;
  label: string;
  status: string;
  message: string;
  attempt: number;
  createdAt: string;
}

const columns: ExportColumn<PublishLogExportRow>[] = [
  { key: 'taskId', header: '任务 ID', width: 12, type: 'number' },
  { key: 'taskTitle', header: '任务', width: 32 },
  { key: 'itemKey', header: '路径/检查点', width: 42 },
  { key: 'label', header: '说明', width: 32 },
  { key: 'status', header: '状态', width: 12 },
  { key: 'message', header: '消息/错误', width: 44 },
  { key: 'attempt', header: '执行次数', width: 12, type: 'number' },
  { key: 'createdAt', header: '记录时间', width: 22, type: 'datetime' },
];

async function buildLogWhere(query: Record<string, unknown>): Promise<SQL | undefined> {
  const siteId = Number(query.siteId);
  const taskId = Number(query.taskId);
  const status = enumValueOf(ASYNC_TASK_ITEM_STATUSES, query.status);
  const taskWhere = await buildCmsPublishingWhere({
    siteId: Number.isInteger(siteId) && siteId > 0 ? siteId : undefined,
  });
  return buildWhere(
    taskWhere,
    eq(asyncTaskItems.taskId, asyncTasks.id),
    asyncTaskStatusCondition(query.taskStatus),
    Number.isInteger(taskId) && taskId > 0 ? eq(asyncTaskItems.taskId, taskId) : undefined,
    status ? eq(asyncTaskItems.status, status) : undefined,
    ...dateRangeConditions(
      asyncTaskItems.createdAt,
      typeof query.startTime === 'string' ? query.startTime : undefined,
      typeof query.endTime === 'string' ? query.endTime : undefined,
    ),
    typeof query.keyword === 'string' ? keywordCondition(query.keyword, [asyncTaskItems.itemKey], 'ilike') : undefined,
  );
}

async function loadRows(query: Record<string, unknown>): Promise<PublishLogExportRow[]> {
  const rows = await db.select({ task: asyncTasks, item: asyncTaskItems }).from(asyncTaskItems)
    .innerJoin(asyncTasks, eq(asyncTaskItems.taskId, asyncTasks.id))
    .where(await buildLogWhere(query))
    .orderBy(desc(asyncTaskItems.id))
    .limit(50_000);
  return rows.map(({ task, item }) => ({
    taskId: task.id,
    taskTitle: task.title,
    itemKey: item.itemKey,
    label: item.label ?? '',
    status: item.status,
    message: item.message ?? '',
    attempt: item.attempt,
    createdAt: formatDateTime(item.createdAt),
  }));
}

export const cmsPublishLogsExportDefinition = defineExport<Record<string, unknown>, PublishLogExportRow>({
  entity: 'cms.publish-logs',
  moduleName: 'CMS发布中心',
  filenamePrefix: 'CMS发布日志',
  sourcePath: '/cms/publishing',
  sheetName: '发布日志',
  formats: ['xlsx', 'csv'],
  permissions: { export: 'cms:publish:view' },
  execution: { mode: 'sync', syncMaxRows: 5000, syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => {
    const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(asyncTaskItems)
      .innerJoin(asyncTasks, eq(asyncTaskItems.taskId, asyncTasks.id))
      .where(await buildLogWhere(query));
    return row?.total ?? 0;
  },
  streamRows: async (query) => loadRows(query),
});
