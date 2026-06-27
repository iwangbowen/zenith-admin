import { and, desc, eq, gte, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { CronExpressionParser } from 'cron-parser';
import { db } from '../db';
import { systemSchedulerRuns, systemSchedulerTaskConfigs } from '../db/schema';
import { currentUserOrNull } from '../lib/context';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../lib/datetime';
import {
  getSchedulerIntrospection,
  getSystemQueueMetrics,
  runSystemRecurringJobNow,
  type SystemSchedulerRunStatus,
  type SystemSchedulerTaskInfo,
} from '../lib/pg-boss-scheduler';
import { withPagination } from '../lib/where-helpers';

export interface ListSystemSchedulerRunsQuery {
  page: number;
  pageSize: number;
  taskName?: string;
  taskType?: 'recurring' | 'queue';
  triggerType?: 'schedule' | 'manual' | 'queue';
  status?: SystemSchedulerRunStatus;
  startTime?: string;
  endTime?: string;
}

export interface UpdateSystemSchedulerTaskConfigInput {
  logRetentionDays: number;
  logRetentionRuns: number;
  timeoutMs?: number | null;
  failureAlertThreshold: number;
  alertEnabled: boolean;
  manualSingleton: boolean;
}

export interface CleanupSystemSchedulerRunsInput {
  taskName?: string;
}

function nextCronRun(cronExpression: string): string | null {
  try {
    const interval = CronExpressionParser.parse(cronExpression.trim(), { currentDate: new Date(), tz: 'Asia/Shanghai' });
    return formatDateTime(interval.next().toDate());
  } catch {
    return null;
  }
}

function mapRun(row: typeof systemSchedulerRuns.$inferSelect) {
  return {
    id: row.id,
    taskName: row.taskName,
    taskTitle: row.taskTitle,
    taskType: row.taskType,
    module: row.module,
    triggerType: row.triggerType,
    status: row.status,
    jobId: row.jobId,
    nodeId: row.nodeId,
    nodeHostname: row.nodeHostname,
    nodePid: row.nodePid,
    triggeredBy: row.triggeredBy,
    startedAt: formatDateTime(row.startedAt),
    endedAt: formatNullableDateTime(row.endedAt),
    durationMs: row.durationMs,
    resultMessage: row.resultMessage,
    errorMessage: row.errorMessage,
    alertedAt: formatNullableDateTime(row.alertedAt),
    alertMessage: row.alertMessage,
    createdAt: formatDateTime(row.createdAt),
  };
}

function registeredTaskOrThrow(name: string): SystemSchedulerTaskInfo {
  const scheduler = getSchedulerIntrospection();
  const task = [...scheduler.systemRecurringJobs, ...scheduler.systemQueueWorkers].find((item) => item.name === name);
  if (!task) throw new HTTPException(404, { message: '系统调度任务不存在或尚未注册' });
  return task;
}

export async function listSystemSchedulerTasks() {
  const scheduler = getSchedulerIntrospection();
  const registeredTasks: SystemSchedulerTaskInfo[] = [
    ...scheduler.systemRecurringJobs,
    ...scheduler.systemQueueWorkers,
  ];
  const taskNames = registeredTasks.map((task) => task.name);
  const [statsRows, configRows, latestRows, latestAlertRows, queueMetrics] = await Promise.all([
    db.select({
      taskName: systemSchedulerRuns.taskName,
      totalRuns: sql<number>`cast(count(*) as int)`,
      successCount: sql<number>`cast(count(*) filter (where ${systemSchedulerRuns.status} = 'success') as int)`,
      failedCount: sql<number>`cast(count(*) filter (where ${systemSchedulerRuns.status} = 'failed') as int)`,
      alertCount: sql<number>`cast(count(*) filter (where ${systemSchedulerRuns.alertMessage} is not null) as int)`,
    }).from(systemSchedulerRuns).groupBy(systemSchedulerRuns.taskName),
    db.select().from(systemSchedulerTaskConfigs),
    Promise.all(registeredTasks.map((task) =>
      db.select()
        .from(systemSchedulerRuns)
        .where(eq(systemSchedulerRuns.taskName, task.name))
        .orderBy(desc(systemSchedulerRuns.startedAt), desc(systemSchedulerRuns.id))
        .limit(1),
    )),
    Promise.all(registeredTasks.map((task) =>
      db.select()
        .from(systemSchedulerRuns)
        .where(and(eq(systemSchedulerRuns.taskName, task.name), isNotNull(systemSchedulerRuns.alertMessage)))
        .orderBy(desc(systemSchedulerRuns.startedAt), desc(systemSchedulerRuns.id))
        .limit(1),
    )),
    getSystemQueueMetrics(taskNames),
  ]);

  const statsMap = new Map(statsRows.map((row) => [row.taskName, row]));
  const configMap = new Map(configRows.map((row) => [row.taskName, row]));
  const latestMap = new Map(latestRows.flat().map((row) => [row.taskName, row]));
  const latestAlertMap = new Map(latestAlertRows.flat().map((row) => [row.taskName, row]));
  const wipMap = new Map(scheduler.wip.map((item) => [item.name, item.count]));

  return registeredTasks
    .map((task) => {
      const stats = statsMap.get(task.name);
      const config = configMap.get(task.name);
      const latest = latestMap.get(task.name);
      const latestAlert = latestAlertMap.get(task.name);
      const metrics = queueMetrics[task.name] ?? {
        queuedCount: 0,
        activeCount: 0,
        deferredCount: 0,
        totalCount: 0,
        failedCount: 0,
        completedCount: 0,
        stateCounts: {},
      };
      return {
        name: task.name,
        title: task.title,
        module: task.module,
        description: task.description,
        taskType: task.taskType,
        cronExpression: task.cronExpression,
        registeredAt: task.registeredAt,
        registeredNodeId: task.registeredNodeId,
        registeredHostname: task.registeredHostname,
        registeredPid: task.registeredPid,
        allowManualRun: task.allowManualRun,
        logRetentionDays: config?.logRetentionDays ?? task.logRetentionDays,
        logRetentionRuns: config?.logRetentionRuns ?? task.logRetentionRuns,
        timeoutMs: config?.timeoutMs ?? task.timeoutMs,
        failureAlertThreshold: config?.failureAlertThreshold ?? task.failureAlertThreshold,
        alertEnabled: config?.alertEnabled ?? task.alertEnabled,
        manualSingleton: config?.manualSingleton ?? task.manualSingleton,
        nextRunAt: task.taskType === 'recurring' && task.cronExpression ? nextCronRun(task.cronExpression) : null,
        running: (wipMap.get(task.name) ?? 0) > 0 || latest?.status === 'running',
        lastRunAt: latest ? formatDateTime(latest.startedAt) : task.lastRunAt,
        lastRunStatus: latest?.status ?? task.lastRunStatus,
        lastRunMessage: latest?.errorMessage ?? latest?.resultMessage ?? task.lastRunMessage,
        lastDurationMs: latest?.durationMs ?? task.lastDurationMs,
        totalRuns: stats?.totalRuns ?? 0,
        successCount: stats?.successCount ?? 0,
        failedCount: stats?.failedCount ?? 0,
        alertCount: stats?.alertCount ?? 0,
        lastAlertAt: latestAlert ? formatNullableDateTime(latestAlert.alertedAt) : null,
        lastAlertMessage: latestAlert?.alertMessage ?? null,
        queueQueuedCount: metrics.queuedCount,
        queueActiveCount: metrics.activeCount,
        queueDeferredCount: metrics.deferredCount,
        queueTotalCount: metrics.totalCount,
        queueFailedCount: metrics.failedCount,
        queueCompletedCount: metrics.completedCount,
        queueStateCounts: metrics.stateCounts,
      };
    })
    .sort((a, b) => a.module.localeCompare(b.module, 'zh-Hans-CN') || a.title.localeCompare(b.title, 'zh-Hans-CN'));
}

export async function listSystemSchedulerRuns(query: ListSystemSchedulerRunsQuery) {
  const { page, pageSize } = query;
  const conditions: SQL[] = [];
  if (query.taskName) conditions.push(eq(systemSchedulerRuns.taskName, query.taskName));
  if (query.taskType) conditions.push(eq(systemSchedulerRuns.taskType, query.taskType));
  if (query.triggerType) conditions.push(eq(systemSchedulerRuns.triggerType, query.triggerType));
  if (query.status) conditions.push(eq(systemSchedulerRuns.status, query.status));
  const startTime = parseDateTimeInput(query.startTime);
  const endTime = parseDateTimeInput(query.endTime);
  if (startTime) conditions.push(gte(systemSchedulerRuns.startedAt, startTime));
  if (endTime) conditions.push(lte(systemSchedulerRuns.startedAt, endTime));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(systemSchedulerRuns, where),
    withPagination(
      db.select().from(systemSchedulerRuns).where(where).orderBy(desc(systemSchedulerRuns.startedAt), desc(systemSchedulerRuns.id)).$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return { list: rows.map(mapRun), total, page, pageSize };
}

export async function runSystemSchedulerTask(name: string) {
  try {
    const user = currentUserOrNull();
    return await runSystemRecurringJobNow(name, user?.userId ?? null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('不存在')) throw new HTTPException(404, { message });
    throw new HTTPException(400, { message });
  }
}

export async function updateSystemSchedulerTaskConfig(name: string, input: UpdateSystemSchedulerTaskConfigInput) {
  registeredTaskOrThrow(name);
  const normalized = {
    logRetentionDays: Math.max(1, input.logRetentionDays),
    logRetentionRuns: Math.max(1, input.logRetentionRuns),
    timeoutMs: input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : null,
    failureAlertThreshold: Math.max(1, input.failureAlertThreshold),
    alertEnabled: input.alertEnabled,
    manualSingleton: input.manualSingleton,
  };
  const [row] = await db.insert(systemSchedulerTaskConfigs).values({
    taskName: name,
    ...normalized,
  }).onConflictDoUpdate({
    target: systemSchedulerTaskConfigs.taskName,
    set: {
      ...normalized,
      updatedAt: new Date(),
    },
  }).returning();
  return row;
}

export async function cleanupSystemSchedulerRuns(input: CleanupSystemSchedulerRunsInput = {}) {
  if (input.taskName) registeredTaskOrThrow(input.taskName);
  const taskNameFilter = input.taskName ? sql`and r.task_name = ${input.taskName}` : sql``;
  const countWhere = input.taskName ? eq(systemSchedulerRuns.taskName, input.taskName) : undefined;
  const beforeAge = await db.$count(systemSchedulerRuns, countWhere);
  await db.execute(sql`
    delete from system_scheduler_runs r
    using system_scheduler_task_configs cfg
    where r.task_name = cfg.task_name
      and r.status <> 'running'
      and r.started_at < now() - (cfg.log_retention_days || ' days')::interval
      ${taskNameFilter}
  `);
  const afterAge = await db.$count(systemSchedulerRuns, countWhere);
  await db.execute(sql`
    delete from system_scheduler_runs r
    using (
      select id
      from (
        select
          r.id,
          row_number() over (partition by r.task_name order by r.started_at desc, r.id desc) as rn,
          coalesce(cfg.log_retention_runs, 1000) as keep_count
        from system_scheduler_runs r
        left join system_scheduler_task_configs cfg on cfg.task_name = r.task_name
        where r.status <> 'running'
        ${taskNameFilter}
      ) ranked
      where ranked.rn > ranked.keep_count
    ) d
    where r.id = d.id
  `);
  const afterCount = await db.$count(systemSchedulerRuns, countWhere);
  return {
    message: `清理完成：按时间删除 ${beforeAge - afterAge} 条，按数量删除 ${afterAge - afterCount} 条`,
    deletedByAge: beforeAge - afterAge,
    deletedByCount: afterAge - afterCount,
    totalBefore: beforeAge,
    totalAfter: afterCount,
  };
}
