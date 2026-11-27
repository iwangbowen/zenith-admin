import { percentOf } from '@zenith/shared/core';
import { CMS_PUBLISH_TASK_TYPES } from '@zenith/shared/cms';
import type { QueryOutputOf } from '@zenith/shared/core';
import { listRows } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { and, desc, eq, exists, gte, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import dayjs from 'dayjs';
import { ASYNC_TASK_TERMINAL_STATUSES, asyncTaskContract, type AsyncTaskStats } from '@zenith/shared/tasks';
import { db } from '../../db';
import { asyncTaskItems, asyncTasks, users } from '../../db/schema';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { APP_TIME_ZONE } from '../../lib/datetime';
import { localDate, localFormat } from '../../lib/datetime-sql';
import { exactTenantCondition, getCreateTenantId } from '../../lib/tenant';
import { currentUser } from '../../lib/context';
import {
  buildTaskTypeMeta,
  cleanupAsyncTasks,
  cleanupTaskState,
  getTaskTypePolicy,
  listTaskHandlers,
  listTaskTypeConfigs,
  mapAsyncTask,
  mapAsyncTaskItem,
  registrationDefaults,
  requestCancelAsyncTask,
  restartAsyncTask,
  resumeAsyncTask,
  updateTaskTypePolicy,
  type UpdateTaskTypePolicyInput,
} from '../../lib/task-center';
import { asyncTaskScopedWhere, requireGlobalTaskScope, retryCmsPublishingTask } from './public/access';
import { asyncTaskWithCreator } from './public/queries';

async function ensureTaskAccessible(id: number, access: 'read' | 'manage') {
  const scope = await asyncTaskScopedWhere(access);
  const [row] = await db.select({ taskType: asyncTasks.taskType }).from(asyncTasks)
    .where(and(eq(asyncTasks.id, id), scope)).limit(1);
  return { task: requireRow(row, '任务不存在或无权访问'), scope };
}

export async function getAsyncTask(id: number) {
  const [row] = await db.select(asyncTaskWithCreator).from(asyncTasks)
    .leftJoin(users, eq(users.id, asyncTasks.createdBy))
    .where(and(eq(asyncTasks.id, id), await asyncTaskScopedWhere())).limit(1);
  return mapAsyncTask(requireRow(row, '任务不存在或无权访问'));
}

export async function getAsyncTaskForCreator(id: number) {
  const user = currentUser();
  const [row] = await db.select().from(asyncTasks).where(and(
    eq(asyncTasks.id, id), eq(asyncTasks.createdBy, user.userId), exactTenantCondition(asyncTasks.tenantId, getCreateTenantId(user)),
  )).limit(1);
  return mapAsyncTask(requireRow(row, '任务不存在或无权访问'));
}

export async function cancelTask(id: number) {
  const { scope } = await ensureTaskAccessible(id, 'manage');
  return mapAsyncTask(await requestCancelAsyncTask(id, scope));
}

export async function resumeTask(id: number) {
  return retryTask(id, 'resume');
}

export async function restartTask(id: number) {
  return retryTask(id, 'restart');
}

async function retryTask(id: number, action: 'resume' | 'restart') {
  const { task, scope } = await ensureTaskAccessible(id, 'manage');
  if (CMS_PUBLISH_TASK_TYPES.some(type => type === task.taskType)) return retryCmsPublishingTask(id, action);
  return mapAsyncTask(await (action === 'resume' ? resumeAsyncTask : restartAsyncTask)(id, scope));
}

export async function deleteAsyncTask(id: number) {
  const scope = await asyncTaskScopedWhere('remove');
  const where = and(eq(asyncTasks.id, id), scope);
  const row = await db.transaction(async tx => {
    const [deleted] = await tx.delete(asyncTasks).where(and(where, inArray(asyncTasks.status, ASYNC_TASK_TERMINAL_STATUSES))).returning();
    if (!deleted) {
      const [existing] = await tx.select({ id: asyncTasks.id }).from(asyncTasks).where(where).limit(1);
      requireRow(existing, '任务不存在或无权访问');
      throw new HTTPException(400, { message: '进行中的任务不能删除，请先取消' });
    }
    await cleanupTaskState(tx, [deleted]);
    return deleted;
  });
  return mapAsyncTask(row);
}

/** 批量取消（跳过不可取消的任务），返回成功取消数 */
export async function batchCancelTasks(ids: number[]) {
  const scope = await asyncTaskScopedWhere('manage');
  let cancelled = 0;
  for (const id of new Set(ids)) {
    try {
      await requestCancelAsyncTask(id, scope);
      cancelled++;
    } catch (error) {
      if (!(error instanceof HTTPException) || error.status !== 400) throw error;
      // 已结束、不存在或超出范围的记录不计入。
    }
  }
  return { affected: cancelled };
}

/** 批量删除（仅已结束的任务），返回删除数 */
export async function batchDeleteTasks(ids: number[]) {
  const scope = await asyncTaskScopedWhere('remove');
  return db.transaction(async tx => {
    const rows = await tx.delete(asyncTasks)
      .where(and(inArray(asyncTasks.id, ids), inArray(asyncTasks.status, ASYNC_TASK_TERMINAL_STATUSES), scope))
      .returning();
    await cleanupTaskState(tx, rows);
    return { affected: rows.length };
  });
}

export async function cleanupFinishedTasks() {
  requireGlobalTaskScope();
  const cleaned = await cleanupAsyncTasks();
  return { cleaned };
}

/** 任务类型列表（注册默认值 + DB 运行时策略合并后的生效值） */
export async function listAsyncTaskTypes() {
  const configs = await listTaskTypeConfigs().catch(() => new Map());
  return listTaskHandlers().map((handler) => buildTaskTypeMeta(handler, configs.get(handler.taskType) ?? registrationDefaults(handler)));
}

/** 更新任务类型运行时策略 */
export async function updateAsyncTaskTypePolicy(taskType: string, input: UpdateTaskTypePolicyInput) {
  requireGlobalTaskScope();
  await updateTaskTypePolicy(taskType, input);
  const maybeHandler = listTaskHandlers().find((item) => item.taskType === taskType);
  const handler = requireRow(maybeHandler, '任务类型未注册');
  return buildTaskTypeMeta(handler, await getTaskTypePolicy(db, taskType));
}

/** 任务项明细分页（创建者本人或管理员可见） */
export async function listAsyncTaskItems(taskId: number, query: QueryOutputOf<typeof asyncTaskContract.items>) {
  const { scope } = await ensureTaskAccessible(taskId, 'read');
  const { page, pageSize } = query;
  const where = buildWhere(
    eq(asyncTaskItems.taskId, taskId),
    exists(db.select({ id: asyncTasks.id }).from(asyncTasks).where(and(eq(asyncTasks.id, asyncTaskItems.taskId), scope))),
    query.status ? eq(asyncTaskItems.status, query.status) : undefined,
    keywordCondition(query.keyword, [asyncTaskItems.itemKey, asyncTaskItems.label, asyncTaskItems.message], 'ilike'),
  );
  return listRows({
    page,
    pageSize,
    table: asyncTaskItems,
    where,
    orderBy: [desc(asyncTaskItems.id)],
        map: mapAsyncTaskItem,
  });
}

/** 任务中心统计概览（状态计数 + 耗时分位 + 今日概览 + 近 14 天/24h 趋势 + 提交人 Top） */
export async function getAsyncTaskStats(): Promise<AsyncTaskStats> {
  const scope = await asyncTaskScopedWhere();
  const dayMs = 24 * 60 * 60 * 1000;
  const since24h = new Date(Date.now() - dayMs);
  const since30d = new Date(Date.now() - 30 * dayMs);
  const nowLocal = dayjs().tz(APP_TIME_ZONE);
  const dailyBucket = localDate(asyncTasks.createdAt);
  const hourlyBucket = localFormat(asyncTasks.createdAt, 'YYYY-MM-DD HH24:00');
  const dailyStart = nowLocal.startOf('day').subtract(13, 'day').toDate();
  const hourlyStart = nowLocal.startOf('hour').subtract(23, 'hour').toDate();
  const todayStart = nowLocal.startOf('day').toDate();
  const yesterdayStart = nowLocal.startOf('day').subtract(1, 'day').toDate();
  // sql`` 模板内的裸 Date 不经过列映射（postgres-js 无法序列化），显式转为 UTC ISO 字符串
  const todayStartParam = todayStart.toISOString();
  const durationMsExpr = sql`extract(epoch from (${asyncTasks.completedAt} - ${asyncTasks.startedAt})) * 1000`;
  const [
    statusRows, [duration], dailyRows, hourlyRows, [todayRow],
    [backlogRow], [retriedRow], [itemsRow], submitterRows, typeRows,
  ] = await Promise.all([
    db.select({ status: asyncTasks.status, count: sql<number>`count(*)::int` })
      .from(asyncTasks).where(scope).groupBy(asyncTasks.status),
    db.select({
      avgMs: sql<number | null>`avg(${durationMsExpr})`,
      p50: sql<number | null>`percentile_cont(0.5) within group (order by ${durationMsExpr})`,
      p95: sql<number | null>`percentile_cont(0.95) within group (order by ${durationMsExpr})`,
      maxMs: sql<number | null>`max(${durationMsExpr})`,
    }).from(asyncTasks)
      .where(and(scope, eq(asyncTasks.status, 'success'), gte(asyncTasks.completedAt, since24h))),
    db.select({
      date: dailyBucket,
      submitted: sql<number>`count(*)::int`,
      success: sql<number>`count(*) filter (where ${asyncTasks.status} = 'success')::int`,
      failed: sql<number>`count(*) filter (where ${asyncTasks.status} = 'failed')::int`,
    }).from(asyncTasks)
      .where(and(scope, gte(asyncTasks.createdAt, dailyStart)))
      .groupBy(dailyBucket)
      .orderBy(dailyBucket),
    db.select({
      hour: hourlyBucket,
      submitted: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${asyncTasks.status} = 'failed')::int`,
    }).from(asyncTasks)
      .where(and(scope, gte(asyncTasks.createdAt, hourlyStart)))
      .groupBy(hourlyBucket)
      .orderBy(hourlyBucket),
    db.select({
      submitted: sql<number>`count(*) filter (where ${asyncTasks.createdAt} >= ${todayStartParam})::int`,
      success: sql<number>`count(*) filter (where ${asyncTasks.createdAt} >= ${todayStartParam} and ${asyncTasks.status} = 'success')::int`,
      failed: sql<number>`count(*) filter (where ${asyncTasks.createdAt} >= ${todayStartParam} and ${asyncTasks.status} = 'failed')::int`,
      yesterdaySubmitted: sql<number>`count(*) filter (where ${asyncTasks.createdAt} < ${todayStartParam})::int`,
    }).from(asyncTasks)
      .where(and(scope, gte(asyncTasks.createdAt, yesterdayStart))),
    db.select({
      oldestMinutes: sql<number | null>`
        extract(epoch from (now() - min(${asyncTasks.createdAt}))) / 60
      `,
    }).from(asyncTasks).where(and(scope, eq(asyncTasks.status, 'pending'))),
    db.select({
      retried: sql<number>`count(*)::int`,
      recovered: sql<number>`count(*) filter (where ${asyncTasks.status} = 'success')::int`,
    }).from(asyncTasks).where(and(scope, sql`${asyncTasks.attempts} > 1`)),
    db.select({
      processed: sql<number>`coalesce(sum(${asyncTasks.processedCount}), 0)::int`,
      failed: sql<number>`coalesce(sum(${asyncTasks.failedCount}), 0)::int`,
    }).from(asyncTasks).where(scope),
    db.select({
      userId: asyncTasks.createdBy,
      username: sql<string | null>`max(coalesce(nullif(${users.nickname}, ''), ${users.username}))`,
      count: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${asyncTasks.status} = 'failed')::int`,
    }).from(asyncTasks)
      .leftJoin(users, eq(users.id, asyncTasks.createdBy))
      .where(and(scope, gte(asyncTasks.createdAt, since30d)))
      .groupBy(asyncTasks.createdBy)
      .orderBy(sql`count(*) desc`)
      .limit(5),
    db.select({
      taskType: asyncTasks.taskType,
      total: sql<number>`count(*)::int`,
      running: sql<number>`count(*) filter (where ${asyncTasks.status} = 'running')::int`,
      success: sql<number>`count(*) filter (where ${asyncTasks.status} = 'success')::int`,
      failed: sql<number>`count(*) filter (where ${asyncTasks.status} = 'failed')::int`,
      avgMs: sql<number | null>`
        avg(extract(epoch from (${asyncTasks.completedAt} - ${asyncTasks.startedAt})) * 1000)
          filter (where ${asyncTasks.status} = 'success')
      `,
    }).from(asyncTasks).where(scope)
      .groupBy(asyncTasks.taskType)
      .orderBy(sql`count(*) desc`),
  ]);
  const counts: Record<string, number> = {};
  for (const row of statusRows) counts[row.status] = row.count;
  const success = counts.success ?? 0;
  const failed = counts.failed ?? 0;
  const settled = success + failed;
  const roundMs = (value: number | null | undefined): number | null =>
    value != null ? Math.round(Number(value)) : null;

  // 类型元数据来自内存注册表；已下线的类型仍可能留有历史记录，回落展示 taskType
  const metaByType = new Map(listTaskHandlers().map((handler) => [handler.taskType, handler]));

  return {
    total: statusRows.reduce((sum, row) => sum + row.count, 0),
    pending: counts.pending ?? 0,
    running: counts.running ?? 0,
    success,
    failed,
    cancelled: counts.cancelled ?? 0,
    avgDurationMs: roundMs(duration?.avgMs),
    duration: {
      p50: roundMs(duration?.p50),
      p95: roundMs(duration?.p95),
      max: roundMs(duration?.maxMs),
    },
    today: {
      submitted: todayRow?.submitted ?? 0,
      success: todayRow?.success ?? 0,
      failed: todayRow?.failed ?? 0,
      yesterdaySubmitted: todayRow?.yesterdaySubmitted ?? 0,
    },
    daily: dailyRows.map((row) => ({
      date: row.date, submitted: row.submitted, success: row.success, failed: row.failed,
    })),
    hourly: hourlyRows.map((row) => ({ hour: row.hour, submitted: row.submitted, failed: row.failed })),
    successRate: percentOf(success, settled),
    backlog: {
      pending: counts.pending ?? 0,
      oldestPendingMinutes: backlogRow?.oldestMinutes != null
        ? Math.round(Number(backlogRow.oldestMinutes))
        : null,
    },
    retried: retriedRow?.retried ?? 0,
    retriedRecovered: retriedRow?.recovered ?? 0,
    items: {
      processed: itemsRow?.processed ?? 0,
      failed: itemsRow?.failed ?? 0,
    },
    topSubmitters: submitterRows.map((row) => ({
      userId: row.userId,
      username: row.userId == null ? '系统' : (row.username ?? `用户 #${row.userId}`),
      count: row.count,
      failed: row.failed,
    })),
    byType: typeRows.map((row) => {
      const settledOfType = row.success + row.failed;
      const meta = metaByType.get(row.taskType);
      return {
        taskType: row.taskType,
        title: meta?.title ?? row.taskType,
        module: meta?.module ?? null,
        total: row.total,
        running: row.running,
        success: row.success,
        failed: row.failed,
        successRate: percentOf(row.success, settledOfType),
        avgDurationMs: row.avgMs != null ? Math.round(Number(row.avgMs)) : null,
      };
    }),
  };
}
