import { uniquePositiveInts } from '@zenith/shared/core';
import type { QueryOutputOf } from '@zenith/shared/core';
import { systemSchedulerContract, type JobStuckItem } from '@zenith/shared/platform';
import { buildListResult, listRows } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { and, desc, eq, gte, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { CronExpressionParser } from 'cron-parser';
import { db } from '../../db';
import { systemSchedulerNodes, systemSchedulerRuns, systemSchedulerTaskConfigs, users } from '../../db/schema';
import { currentUserOrNull } from '../../lib/context';
import { formatDateTime, formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import {
  getSchedulerIntrospection,
  getSystemQueueMetrics,
  getQueueDepths,
  runSystemRecurringJobNow,
  updateSystemTaskRuntimePolicy,
  type SystemSchedulerAlertChannel,
  type SystemSchedulerTaskPolicy,
  type SystemSchedulerTaskInfo,
} from '../../lib/pg-boss-scheduler';
import { buildWhere, dateRangeConditions, withPagination } from '../../lib/where-helpers';
import type { JobSourceRawSummary } from '../../lib/job-monitor/registry';

/** 超时策略来自任务配置，未设阈值时按半小时识别未收尾运行。 */
export function overdueSchedulerRunCondition(asOf = new Date()) {
  return and(eq(systemSchedulerRuns.status, 'running'), sql`${systemSchedulerRuns.startedAt} + coalesce(${systemSchedulerTaskConfigs.timeoutMs}, 1800000) * interval '1 millisecond' < ${asOf}`);
}

/** 队列真实积压使用 ready；运行留痕成败按结束时间，避免把历史失败当24h失败。 */
export async function getSchedulerRunHealth(): Promise<JobSourceRawSummary> {
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const hour = new Date(now.getTime() - 3_600_000);
  const [depths, [row], oldestRows] = await Promise.all([
    getQueueDepths(),
    db.select({
      running: sql<number>`count(*) filter (where ${systemSchedulerRuns.status} = 'running')::int`,
      stuck: sql<number>`count(*) filter (where ${overdueSchedulerRunCondition(now)})::int`,
      failed24h: sql<number>`count(*) filter (where ${systemSchedulerRuns.status} = 'failed' and ${systemSchedulerRuns.endedAt} >= ${since})::int`,
      succeeded24h: sql<number>`count(*) filter (where ${systemSchedulerRuns.status} = 'success' and ${systemSchedulerRuns.endedAt} >= ${since})::int`,
      failed1h: sql<number>`count(*) filter (where ${systemSchedulerRuns.status} = 'failed' and ${systemSchedulerRuns.endedAt} >= ${hour})::int`,
    }).from(systemSchedulerRuns)
      .leftJoin(systemSchedulerTaskConfigs, eq(systemSchedulerTaskConfigs.taskName, systemSchedulerRuns.taskName))
      .where(or(eq(systemSchedulerRuns.status, 'running'), and(inArray(systemSchedulerRuns.status, ['success', 'failed']), gte(systemSchedulerRuns.endedAt, since)))),
    db.execute<{ age: number | null }>(sql`
      select floor(extract(epoch from (${now}::timestamptz - min(start_after))))::int as age
      from pgboss.job
      where state in ('created', 'retry') and start_after <= ${now}
        and left(name, 10) <> '__pgboss__'
    `),
  ]);
  return {
    counts: { pending: depths.reduce((sum, queue) => sum + queue.ready, 0), running: row?.running ?? 0, stuck: row?.stuck ?? 0, dead: null, failed24h: row?.failed24h ?? 0, succeeded24h: row?.succeeded24h ?? 0 },
    oldestPendingAgeSec: oldestRows[0]?.age ?? null,
    failed1h: row?.failed1h ?? 0,
    issues: [],
  };
}

export async function listOverdueSchedulerRuns(limit: number): Promise<JobStuckItem[]> {
  const now = new Date();
  const rows = await db.select({
    id: systemSchedulerRuns.id, taskTitle: systemSchedulerRuns.taskTitle, status: systemSchedulerRuns.status,
    startedAt: systemSchedulerRuns.startedAt, nodeId: systemSchedulerRuns.nodeId,
    errorMessage: systemSchedulerRuns.errorMessage, resultMessage: systemSchedulerRuns.resultMessage,
  }).from(systemSchedulerRuns)
    .leftJoin(systemSchedulerTaskConfigs, eq(systemSchedulerTaskConfigs.taskName, systemSchedulerRuns.taskName))
    .where(overdueSchedulerRunCondition(now)).orderBy(systemSchedulerRuns.startedAt, systemSchedulerRuns.id).limit(limit);
  return rows.map((row) => ({
    source: 'scheduler-queue', refId: String(row.id), title: row.taskTitle, status: row.status,
    startedAt: formatDateTime(row.startedAt), lastSeenAt: formatDateTime(row.startedAt),
    ageSec: Math.max(0, Math.floor((now.getTime() - row.startedAt.getTime()) / 1000)),
    nodeId: row.nodeId, detail: row.errorMessage ?? row.resultMessage,
    drillDown: { path: '/system/scheduler?tab=runs&status=running', label: '查看运行记录' },
  }));
}

export interface UpdateSystemSchedulerTaskConfigInput {
  enabled: boolean;
  logRetentionDays: number;
  logRetentionRuns: number;
  timeoutMs?: number | null;
  failureAlertThreshold: number;
  alertEnabled: boolean;
  alertChannels: SystemSchedulerAlertChannel[];
  alertUserIds: number[];
  alertEmails: string[];
  alertWebhookUrl?: string | null;
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
    alertSentAt: formatNullableDateTime(row.alertSentAt),
    alertChannels: row.alertChannels ?? [],
    alertAckAt: formatNullableDateTime(row.alertAckAt),
    alertAckBy: row.alertAckBy,
    alertAckByName: null,
    alertAckNote: row.alertAckNote,
    createdAt: formatDateTime(row.createdAt),
  };
}

function mapRunWithAckUser(row: typeof systemSchedulerRuns.$inferSelect, ackUser?: { nickname: string | null; username: string } | null) {
  return {
    ...mapRun(row),
    alertAckByName: ackUser ? (ackUser.nickname || ackUser.username) : null,
  };
}

function mapNode(row: typeof systemSchedulerNodes.$inferSelect) {
  const stale = Date.now() - row.lastHeartbeatAt.getTime() > 90_000;
  return {
    nodeId: row.nodeId,
    hostname: row.hostname,
    pid: row.pid,
    roles: row.roles,
    version: row.version,
    startedAt: formatDateTime(row.startedAt),
    lastHeartbeatAt: formatDateTime(row.lastHeartbeatAt),
    registeredTaskCount: row.registeredTaskCount,
    runningJobCount: row.runningJobCount,
    active: row.active,
    stale,
    metadata: row.metadata ?? {},
    ...formatTimestamps(row),
  };
}

function registeredTaskOrThrow(name: string): SystemSchedulerTaskInfo {
  const scheduler = getSchedulerIntrospection();
  const maybeTask = [...scheduler.systemRecurringJobs, ...scheduler.systemQueueWorkers].find((item) => item.name === name);
  const task = requireRow(maybeTask, '系统调度任务不存在或尚未注册');
  return task;
}

export async function listSystemSchedulerTasks() {
  const scheduler = getSchedulerIntrospection();
  const registeredTasks: SystemSchedulerTaskInfo[] = [
    ...scheduler.systemRecurringJobs,
    ...scheduler.systemQueueWorkers,
  ];
  const taskNames = registeredTasks.map((task) => task.name);
  // 每任务一行「最近一次」：unnest(任务名) × LATERAL limit 1 —— 一条语句内对每个任务做一次
  // system_scheduler_runs_task_started_idx 倒扫探测（loose index scan），替代按任务逐个 limit(1) 的 2N 次并行查询
  // （40+ 个注册任务会瞬时占满 20 连接的池）。DISTINCT ON 在 PG 里没有 loose index scan，会退化成全表排序，不可用
  const latestRunPerTask = (extra?: SQL) => {
    const latest = db
      .select({ id: systemSchedulerRuns.id })
      .from(systemSchedulerRuns)
      .where(buildWhere(eq(systemSchedulerRuns.taskName, sql`t.name`), extra))
      .orderBy(desc(systemSchedulerRuns.startedAt), desc(systemSchedulerRuns.id))
      .limit(1)
      .as('latest');
    const latestIds = db
      .select({ id: latest.id })
      .from(sql`unnest(array[${sql.join(taskNames.map((name) => sql`${name}`), sql`, `)}]::varchar[]) as t(name)`)
      .crossJoinLateral(latest);
    return db.select().from(systemSchedulerRuns).where(inArray(systemSchedulerRuns.id, latestIds));
  };
  const [statsRows, configRows, latestRows, latestAlertRows, queueMetrics] = await Promise.all([
    db.select({
      taskName: systemSchedulerRuns.taskName,
      totalRuns: sql<number>`cast(count(*) as int)`,
      successCount: sql<number>`cast(count(*) filter (where ${systemSchedulerRuns.status} = 'success') as int)`,
      failedCount: sql<number>`cast(count(*) filter (where ${systemSchedulerRuns.status} = 'failed') as int)`,
      alertCount: sql<number>`cast(count(*) filter (where ${systemSchedulerRuns.alertMessage} is not null) as int)`,
    }).from(systemSchedulerRuns).groupBy(systemSchedulerRuns.taskName),
    db.select().from(systemSchedulerTaskConfigs),
    latestRunPerTask(),
    latestRunPerTask(isNotNull(systemSchedulerRuns.alertMessage)),
    getSystemQueueMetrics(taskNames),
  ]);

  const statsMap = new Map(statsRows.map((row) => [row.taskName, row]));
  const configMap = new Map(configRows.map((row) => [row.taskName, row]));
  const latestMap = new Map(latestRows.map((row) => [row.taskName, row]));
  const latestAlertMap = new Map(latestAlertRows.map((row) => [row.taskName, row]));
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
        enabled: config?.enabled ?? task.enabled,
        logRetentionDays: config?.logRetentionDays ?? task.logRetentionDays,
        logRetentionRuns: config?.logRetentionRuns ?? task.logRetentionRuns,
        timeoutMs: config?.timeoutMs ?? task.timeoutMs,
        failureAlertThreshold: config?.failureAlertThreshold ?? task.failureAlertThreshold,
        alertEnabled: config?.alertEnabled ?? task.alertEnabled,
        alertChannels: config?.alertChannels ?? task.alertChannels,
        alertUserIds: config?.alertUserIds ?? task.alertUserIds,
        alertEmails: config?.alertEmails ?? task.alertEmails,
        alertWebhookUrl: config?.alertWebhookUrl ?? task.alertWebhookUrl,
        manualSingleton: config?.manualSingleton ?? task.manualSingleton,
        nextRunAt: task.taskType === 'recurring' && task.cronExpression && (config?.enabled ?? task.enabled) ? nextCronRun(task.cronExpression) : null,
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

export async function listSystemSchedulerRuns(query: QueryOutputOf<typeof systemSchedulerContract.runs>) {
  const { page, pageSize } = query;
  const where = buildWhere(
    query.taskName ? eq(systemSchedulerRuns.taskName, query.taskName) : undefined,
    query.taskType ? eq(systemSchedulerRuns.taskType, query.taskType) : undefined,
    query.triggerType ? eq(systemSchedulerRuns.triggerType, query.triggerType) : undefined,
    query.status ? eq(systemSchedulerRuns.status, query.status) : undefined,
    query.alertStatus === 'alerted' ? isNotNull(systemSchedulerRuns.alertMessage) : undefined,
    query.alertStatus === 'unacked' ? and(isNotNull(systemSchedulerRuns.alertMessage), sql`${systemSchedulerRuns.alertAckAt} is null`) : undefined,
    ...dateRangeConditions(systemSchedulerRuns.startedAt, query.startTime, query.endTime),
  );
  return listRows({
    page,
    pageSize,
    table: systemSchedulerRuns,
    where,
    orderBy: [desc(systemSchedulerRuns.startedAt), desc(systemSchedulerRuns.id)],
    map: mapRun,
  });
}

export async function getSystemSchedulerRun(id: number) {
  const [record] = await db.select({ run: systemSchedulerRuns, ackUser: { username: users.username, nickname: users.nickname } })
    .from(systemSchedulerRuns)
    .leftJoin(users, eq(systemSchedulerRuns.alertAckBy, users.id))
    .where(eq(systemSchedulerRuns.id, id))
    .limit(1);
  const existing = requireRow(record, '运行日志不存在');
  return mapRunWithAckUser(existing.run, existing.ackUser);
}

export async function acknowledgeSystemSchedulerRunAlert(id: number, note?: string | null) {
  const user = currentUserOrNull();
  const row = requireRow(await db.query.systemSchedulerRuns.findFirst({ where: eq(systemSchedulerRuns.id, id) }), '运行日志不存在');
  if (!row.alertMessage) throw new HTTPException(400, { message: '该运行日志没有告警' });
  const [updated] = await db.update(systemSchedulerRuns).set({
    alertAckAt: new Date(),
    alertAckBy: user?.userId ?? null,
    alertAckNote: note?.trim() || null,
  }).where(eq(systemSchedulerRuns.id, id)).returning();
  return mapRun(updated);
}

export async function listSystemSchedulerNodes(query: QueryOutputOf<typeof systemSchedulerContract.nodes>) {
  const { page, pageSize } = query;
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(systemSchedulerNodes),
    rows: () => withPagination(
      db.select().from(systemSchedulerNodes)
        .orderBy(desc(systemSchedulerNodes.active), desc(systemSchedulerNodes.lastHeartbeatAt)).$dynamic(),
      page, pageSize,
    ),
    map: mapNode,
  });
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
  const task = registeredTaskOrThrow(name);
  const alertChannels: SystemSchedulerAlertChannel[] = Array.from(new Set((input.alertChannels ?? []).filter((item): item is SystemSchedulerAlertChannel => item === 'inapp' || item === 'email' || item === 'webhook')));
  const normalized: SystemSchedulerTaskPolicy = {
    enabled: task.taskType === 'queue' ? true : Boolean(input.enabled),
    logRetentionDays: Math.max(1, input.logRetentionDays),
    logRetentionRuns: Math.max(1, input.logRetentionRuns),
    timeoutMs: input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : null,
    failureAlertThreshold: Math.max(1, input.failureAlertThreshold),
    alertEnabled: input.alertEnabled,
    alertChannels: alertChannels.length > 0 ? alertChannels : ['inapp'],
    alertUserIds: uniquePositiveInts(input.alertUserIds),
    alertEmails: Array.from(new Set((input.alertEmails ?? []).map((item) => String(item ?? '').trim()).filter(Boolean))),
    alertWebhookUrl: input.alertWebhookUrl?.trim() || null,
    manualSingleton: task.allowManualRun ? input.manualSingleton : false,
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
  await updateSystemTaskRuntimePolicy(name, normalized);
  return { ...row, ...formatTimestamps(row) };
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
