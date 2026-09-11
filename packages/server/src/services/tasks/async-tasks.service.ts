import { percentOf } from '@zenith/shared/core';
import type { QueryOutputOf } from '@zenith/shared/core';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { and, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import dayjs from 'dayjs';
import { ASYNC_TASK_TERMINAL_STATUSES, asyncTaskContract, isAsyncTaskTerminal, type AsyncTaskStats } from '@zenith/shared/tasks';
import { db } from '../../db';
import { asyncTaskItems, asyncTasks, users } from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { APP_TIME_ZONE } from '../../lib/datetime';
import { currentUser, hasPermission } from '../../lib/context';
import {
  buildTaskTypeMeta,
  cleanupAsyncTasks,
  asyncTaskStatusCondition,
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

type AsyncTaskListFilter = Omit<QueryOutputOf<typeof asyncTaskContract.list>, 'page' | 'pageSize'>;

function buildAsyncTaskWhere(query: AsyncTaskListFilter, extra?: SQL): SQL | undefined {
  return buildWhere(
    query.taskType ? eq(asyncTasks.taskType, query.taskType) : undefined,
    asyncTaskStatusCondition(query.status),
    keywordCondition(query.keyword, [asyncTasks.title, asyncTasks.taskType], 'ilike'),
    keywordCondition(query.content, [sql`${asyncTasks.payload}::text`, sql`${asyncTasks.result}::text`], 'ilike'),
    ...dateRangeConditions(asyncTasks.createdAt, query.startTime, query.endTime),
    extra,
  );
}

/** 提交人筛选：先按用户名/昵称匹配用户，再按 createdBy 过滤；无匹配返回 null（调用方直接返回空列表） */
async function creatorCondition(createdBy: string): Promise<SQL | null> {
  const matched = await db.select({ id: users.id }).from(users)
    .where(keywordCondition(createdBy, [users.username, users.nickname], 'ilike'))
    .limit(500);
  if (matched.length === 0) return null;
  return inArray(asyncTasks.createdBy, matched.map((row) => row.id));
}

async function queryTasks(where: SQL | undefined, page: number, pageSize: number) {
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(asyncTasks, where),
    rows: () => db.query.asyncTasks.findMany({
      where,
      with: { createdByUser: { columns: { nickname: true, username: true } } },
      orderBy: desc(asyncTasks.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    map: mapAsyncTask,
  });
}

/** 管理端全局任务列表（任务中心页面） */
export async function listAsyncTasks(query: QueryOutputOf<typeof asyncTaskContract.list>) {
  const { page, pageSize } = query;
  let extra: SQL | undefined;
  if (query.createdBy) {
    const cond = await creatorCondition(query.createdBy);
    if (!cond) return { list: [], total: 0, page, pageSize };
    extra = cond;
  }
  return queryTasks(buildAsyncTaskWhere(query, extra), page, pageSize);
}

/** 当前用户自己的任务列表（业务页面进度展示） */
export async function listMyAsyncTasks(query: QueryOutputOf<typeof asyncTaskContract.mine>) {
  const user = currentUser();
  const { page, pageSize } = query;
  return queryTasks(buildAsyncTaskWhere(query, eq(asyncTasks.createdBy, user.userId)), page, pageSize);
}

/** 校验当前用户可访问/操作该任务（创建者本人，或持有指定权限的管理员） */
export interface AsyncTaskAccessScope {
  userId: number;
  global: boolean;
}

export async function resolveAsyncTaskAccessScope(
  permission: 'system:async-task:list' | 'system:async-task:manage' = 'system:async-task:list',
): Promise<AsyncTaskAccessScope> {
  const user = currentUser();
  return { userId: user.userId, global: await hasPermission(permission) };
}

export function canAccessAsyncTaskForScope(
  task: { createdBy: number | null },
  scope: AsyncTaskAccessScope,
): boolean {
  return task.createdBy === scope.userId || scope.global;
}

async function ensureTaskAccessible(id: number, permission: 'system:async-task:list' | 'system:async-task:manage') {
  const row = requireRow(await db.query.asyncTasks.findFirst({ where: eq(asyncTasks.id, id) }), '任务不存在');
  const scope = await resolveAsyncTaskAccessScope(permission);
  if (!canAccessAsyncTaskForScope(row, scope)) {
    throw new HTTPException(403, { message: '无权访问该任务' });
  }
  return row;
}

export async function getAsyncTask(id: number) {
  await ensureTaskAccessible(id, 'system:async-task:list');
  const row = await db.query.asyncTasks.findFirst({
    where: eq(asyncTasks.id, id),
    with: { createdByUser: { columns: { nickname: true, username: true } } },
  });
  return mapAsyncTask(requireRow(row, '任务不存在'));
}

export async function cancelTask(id: number) {
  await ensureTaskAccessible(id, 'system:async-task:manage');
  return mapAsyncTask(await requestCancelAsyncTask(id));
}

export async function resumeTask(id: number) {
  await ensureTaskAccessible(id, 'system:async-task:manage');
  return mapAsyncTask(await resumeAsyncTask(id));
}

export async function restartTask(id: number) {
  await ensureTaskAccessible(id, 'system:async-task:manage');
  return mapAsyncTask(await restartAsyncTask(id));
}

export async function deleteAsyncTask(id: number) {
  const row = requireRow(await db.query.asyncTasks.findFirst({ where: eq(asyncTasks.id, id) }), '任务不存在');
  if (!isAsyncTaskTerminal(row.status)) {
    throw new HTTPException(400, { message: '进行中的任务不能删除，请先取消' });
  }
  await db.delete(asyncTasks).where(and(eq(asyncTasks.id, id), inArray(asyncTasks.status, ASYNC_TASK_TERMINAL_STATUSES)));
  return mapAsyncTask(row);
}

/** 批量取消（跳过不可取消的任务），返回成功取消数 */
export async function batchCancelTasks(ids: number[]) {
  let cancelled = 0;
  for (const id of ids) {
    try {
      await requestCancelAsyncTask(id);
      cancelled++;
    } catch {
      // 已结束/不存在的任务直接跳过
    }
  }
  return { affected: cancelled };
}

/** 批量删除（仅已结束的任务），返回删除数 */
export async function batchDeleteTasks(ids: number[]) {
  const rows = await db.delete(asyncTasks)
    .where(and(inArray(asyncTasks.id, ids), inArray(asyncTasks.status, ASYNC_TASK_TERMINAL_STATUSES)))
    .returning({ id: asyncTasks.id });
  return { affected: rows.length };
}

export async function cleanupFinishedTasks() {
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
  await updateTaskTypePolicy(taskType, input);
  const maybeHandler = listTaskHandlers().find((item) => item.taskType === taskType);
  const handler = requireRow(maybeHandler, '任务类型未注册');
  return buildTaskTypeMeta(handler, await getTaskTypePolicy(db, taskType));
}

/** 任务项明细分页（创建者本人或管理员可见） */
export async function listAsyncTaskItems(taskId: number, query: QueryOutputOf<typeof asyncTaskContract.items>) {
  await ensureTaskAccessible(taskId, 'system:async-task:list');
  const { page, pageSize } = query;
  const where = buildWhere(
    eq(asyncTaskItems.taskId, taskId),
    query.status ? eq(asyncTaskItems.status, query.status) : undefined,
    keywordCondition(query.keyword, [asyncTaskItems.itemKey, asyncTaskItems.label, asyncTaskItems.message], 'ilike'),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(asyncTaskItems, where),
    rows: () => db.select().from(asyncTaskItems).where(where)
      .orderBy(desc(asyncTaskItems.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    map: mapAsyncTaskItem,
  });
}

/** 任务中心统计概览（状态计数 + 耗时分位 + 今日概览 + 近 14 天/24h 趋势 + 提交人 Top） */
export async function getAsyncTaskStats(): Promise<AsyncTaskStats> {
  const dayMs = 24 * 60 * 60 * 1000;
  const since24h = new Date(Date.now() - dayMs);
  const since30d = new Date(Date.now() - 30 * dayMs);
  // 时间列存的是 UTC 裸时间，按应用时区出日期/小时桶（与 open-api-stats 同一手法），
  // 窗口起点对齐本地整天/整点，与前端的补桶逻辑一致
  const tzSql = sql.raw(`'${APP_TIME_ZONE.replaceAll("'", "''")}'`);
  const localCreatedAt = sql`${asyncTasks.createdAt} at time zone 'UTC' at time zone ${tzSql}`;
  const nowLocal = dayjs().tz(APP_TIME_ZONE);
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
      .from(asyncTasks).groupBy(asyncTasks.status),
    db.select({
      avgMs: sql<number | null>`avg(${durationMsExpr})`,
      p50: sql<number | null>`percentile_cont(0.5) within group (order by ${durationMsExpr})`,
      p95: sql<number | null>`percentile_cont(0.95) within group (order by ${durationMsExpr})`,
      maxMs: sql<number | null>`max(${durationMsExpr})`,
    }).from(asyncTasks)
      .where(and(eq(asyncTasks.status, 'success'), gte(asyncTasks.completedAt, since24h))),
    db.select({
      date: sql<string>`to_char(${localCreatedAt}, 'YYYY-MM-DD')`,
      submitted: sql<number>`count(*)::int`,
      success: sql<number>`count(*) filter (where ${asyncTasks.status} = 'success')::int`,
      failed: sql<number>`count(*) filter (where ${asyncTasks.status} = 'failed')::int`,
    }).from(asyncTasks)
      .where(gte(asyncTasks.createdAt, dailyStart))
      .groupBy(sql`to_char(${localCreatedAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${localCreatedAt}, 'YYYY-MM-DD')`),
    db.select({
      hour: sql<string>`to_char(date_trunc('hour', ${localCreatedAt}), 'YYYY-MM-DD HH24:00')`,
      submitted: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${asyncTasks.status} = 'failed')::int`,
    }).from(asyncTasks)
      .where(gte(asyncTasks.createdAt, hourlyStart))
      .groupBy(sql`date_trunc('hour', ${localCreatedAt})`)
      .orderBy(sql`date_trunc('hour', ${localCreatedAt})`),
    db.select({
      submitted: sql<number>`count(*) filter (where ${asyncTasks.createdAt} >= ${todayStartParam})::int`,
      success: sql<number>`count(*) filter (where ${asyncTasks.createdAt} >= ${todayStartParam} and ${asyncTasks.status} = 'success')::int`,
      failed: sql<number>`count(*) filter (where ${asyncTasks.createdAt} >= ${todayStartParam} and ${asyncTasks.status} = 'failed')::int`,
      yesterdaySubmitted: sql<number>`count(*) filter (where ${asyncTasks.createdAt} < ${todayStartParam})::int`,
    }).from(asyncTasks)
      .where(gte(asyncTasks.createdAt, yesterdayStart)),
    db.select({
      oldestMinutes: sql<number | null>`
        extract(epoch from (now() - min(${asyncTasks.createdAt}))) / 60
      `,
    }).from(asyncTasks).where(eq(asyncTasks.status, 'pending')),
    db.select({
      retried: sql<number>`count(*)::int`,
      recovered: sql<number>`count(*) filter (where ${asyncTasks.status} = 'success')::int`,
    }).from(asyncTasks).where(sql`${asyncTasks.attempts} > 1`),
    db.select({
      processed: sql<number>`coalesce(sum(${asyncTasks.processedCount}), 0)::int`,
      failed: sql<number>`coalesce(sum(${asyncTasks.failedCount}), 0)::int`,
    }).from(asyncTasks),
    db.select({
      userId: asyncTasks.createdBy,
      username: sql<string | null>`max(coalesce(nullif(${users.nickname}, ''), ${users.username}))`,
      count: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${asyncTasks.status} = 'failed')::int`,
    }).from(asyncTasks)
      .leftJoin(users, eq(users.id, asyncTasks.createdBy))
      .where(gte(asyncTasks.createdAt, since30d))
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
    }).from(asyncTasks)
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
