import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../../db';
import { asyncTaskItems, asyncTasks } from '../../../db/schema';
import { formatDateTime } from '../../datetime';
import { buildWhere, dateRangeConditions } from '../../where-helpers';
import { assertSiteAccess, ensureCmsSiteExists } from '../../../services/cms/cms-sites.service';
import { resolveAsyncTaskAccessScope } from '../../../services/tasks/async-tasks.service';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

interface GovernanceExportRow extends Record<string, unknown> {
  taskId: number;
  taskTitle: string;
  itemKey: string;
  label: string;
  status: string;
  message: string;
  resourceId: number | null;
  operation: string;
  createdAt: string;
}

const columns: ExportColumn<GovernanceExportRow>[] = [
  { key: 'taskId', header: '任务 ID', width: 12, type: 'number' },
  { key: 'taskTitle', header: '任务', width: 28 },
  { key: 'itemKey', header: '明细标识', width: 20 },
  { key: 'label', header: '素材', width: 32 },
  { key: 'status', header: '状态', width: 12 },
  { key: 'message', header: '治理结果', width: 36 },
  { key: 'resourceId', header: '素材 ID', width: 12, type: 'number' },
  { key: 'operation', header: '操作', width: 14 },
  { key: 'createdAt', header: '任务时间', width: 22, type: 'datetime' },
];

function positive(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function loadRows(query: Record<string, unknown>): Promise<GovernanceExportRow[]> {
  const siteId = positive(query.siteId);
  if (!siteId) return [];
  const access = await resolveAsyncTaskAccessScope('system:async-task:list');
  if (access.global) await ensureCmsSiteExists(siteId);
  else await assertSiteAccess(siteId);
  const taskId = positive(query.taskId);
  const where = buildWhere(
    eq(asyncTasks.taskType, 'cms-resource-governance'),
    sql`${asyncTasks.payload}->>'siteId' = ${String(siteId)}`,
    access.global ? undefined : eq(asyncTasks.createdBy, access.userId),
    taskId ? eq(asyncTasks.id, taskId) : undefined,
    ...dateRangeConditions(
      asyncTasks.createdAt,
      typeof query.startTime === 'string' ? query.startTime : undefined,
      typeof query.endTime === 'string' ? query.endTime : undefined,
    ),
  );
  const rows = await db.select({ task: asyncTasks, item: asyncTaskItems })
    .from(asyncTaskItems)
    .innerJoin(asyncTasks, eq(asyncTaskItems.taskId, asyncTasks.id))
    .where(where)
    .orderBy(desc(asyncTasks.id), asyncTaskItems.id)
    .limit(50_000);
  return rows.map(({ task, item }) => ({
    taskId: task.id,
    taskTitle: task.title,
    itemKey: item.itemKey,
    label: item.label ?? '',
    status: item.status,
    message: item.message ?? '',
    resourceId: positive(item.data?.resourceId),
    operation: typeof item.data?.operation === 'string' ? item.data.operation : '',
    createdAt: formatDateTime(task.createdAt),
  }));
}

export const cmsResourceGovernanceExportDefinition = defineExport<Record<string, unknown>, GovernanceExportRow>({
  entity: 'cms.resource-governance',
  moduleName: 'CMS内容管理',
  filenamePrefix: 'CMS素材治理报告',
  sourcePath: '/cms/resources',
  sheetName: '治理明细',
  formats: ['xlsx', 'csv'],
  permissions: { export: 'cms:resource:list' },
  execution: { mode: 'sync', syncMaxRows: 5000, syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => loadRows(query).then((rows) => rows.length),
  streamRows: async (query) => loadRows(query),
});
