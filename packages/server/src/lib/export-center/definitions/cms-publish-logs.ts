import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '../../../db';
import { asyncTaskItems, asyncTasks } from '../../../db/schema';
import { formatDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../datetime';
import { keywordCondition } from '../../where-helpers';
import { buildCmsPublishingConditions } from '../../../services/cms/cms-publishing.service';
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

async function conditions(query: Record<string, unknown>): Promise<(SQL | undefined)[]> {
  const siteId = Number(query.siteId);
  const taskId = Number(query.taskId);
  const taskConditions = await buildCmsPublishingConditions({
    siteId: Number.isInteger(siteId) && siteId > 0 ? siteId : undefined,
  });
  const result: (SQL | undefined)[] = [...taskConditions, eq(asyncTaskItems.taskId, asyncTasks.id)];
  const taskStatus = typeof query.taskStatus === 'string' ? query.taskStatus : undefined;
  if (taskStatus === 'active') result.push(inArray(asyncTasks.status, ['pending', 'running']));
  else if (taskStatus === 'terminal') result.push(inArray(asyncTasks.status, ['success', 'failed', 'cancelled']));
  else if (taskStatus && ['pending', 'running', 'success', 'failed', 'cancelled'].includes(taskStatus)) {
    result.push(eq(asyncTasks.status, taskStatus as 'pending' | 'running' | 'success' | 'failed' | 'cancelled'));
  }
  if (Number.isInteger(taskId) && taskId > 0) result.push(eq(asyncTaskItems.taskId, taskId));
  if (typeof query.status === 'string' && ['pending', 'success', 'failed', 'skipped'].includes(query.status)) {
    result.push(eq(asyncTaskItems.status, query.status as 'pending' | 'success' | 'failed' | 'skipped'));
  }
  const start = parseDateRangeStart(typeof query.startTime === 'string' ? query.startTime : undefined);
  const end = parseDateRangeEnd(typeof query.endTime === 'string' ? query.endTime : undefined);
  if (start) result.push(gte(asyncTaskItems.createdAt, start));
  if (end) result.push(lte(asyncTaskItems.createdAt, end));
  if (typeof query.keyword === 'string') result.push(keywordCondition(query.keyword, [asyncTaskItems.itemKey], 'ilike'));
  return result;
}

async function loadRows(query: Record<string, unknown>): Promise<PublishLogExportRow[]> {
  const rows = await db.select({ task: asyncTasks, item: asyncTaskItems }).from(asyncTaskItems)
    .innerJoin(asyncTasks, eq(asyncTaskItems.taskId, asyncTasks.id))
    .where(and(...await conditions(query)))
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
      .where(and(...await conditions(query)));
    return row?.total ?? 0;
  },
  streamRows: async (query) => loadRows(query),
});
