import { desc } from 'drizzle-orm';
import { db } from '../../../db';
import { cronJobs } from '../../../db/schema';
import { batchIterable } from '../../excel-export';
import { buildCronJobsWhere, type CronJobListFilter } from '../../../services/tasks/cron-jobs.service';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import type { ExportColumn } from '../types';

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'name', header: '任务名称', width: 20 },
  { key: 'cronExpression', header: 'Cron 表达式', width: 18 },
  { key: 'handler', header: '处理器', width: 20 },
  { key: 'status', header: '状态', width: 10 },
  { key: 'lastRunAt', header: '最后执行', width: 22, type: 'datetime' },
  { key: 'lastRunStatus', header: '执行结果', width: 12 },
  { key: 'description', header: '描述', width: 30 },
];

export const cronJobsExportDefinition = defineExport<CronJobListFilter & Record<string, unknown>, Record<string, unknown>>({
  entity: 'system.cron-jobs',
  moduleName: '定时任务',
  filenamePrefix: '定时任务',
  sourcePath: '/system/cron-jobs',
  sheetName: '定时任务',
  permissions: { export: 'system:cronjob:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async (query) => db.$count(cronJobs, buildCronJobsWhere(query)),
  streamRows: async (query) => {
    const where = buildCronJobsWhere(query);
    return batchIterable((limit, offset) =>
      db.select().from(cronJobs).where(where).orderBy(desc(cronJobs.id)).limit(limit).offset(offset),
    );
  },
});
