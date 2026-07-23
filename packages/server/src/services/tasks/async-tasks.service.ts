import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { AsyncTaskItemStatus, AsyncTaskStats, AsyncTaskStatus } from '@zenith/shared';
import { db } from '../../db';
import { asyncTaskItems, asyncTasks, users } from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import { formatDateTime, parseDateTimeInput } from '../../lib/datetime';
import { currentUser, hasPermission } from '../../lib/context';
import {
  buildTaskTypeMeta,
  cleanupAsyncTasks,
  getTaskTypePolicy,
  listTaskHandlers,
  listTaskTypeConfigs,
  mapAsyncTask,
  registrationDefaults,
  requestCancelAsyncTask,
  restartAsyncTask,
  resumeAsyncTask,
  updateTaskTypePolicy,
  type UpdateTaskTypePolicyInput,
} from '../../lib/task-center';

export interface ListAsyncTasksQuery {
  page?: number;
  pageSize?: number;
  taskType?: string;
  status?: AsyncTaskStatus;
  keyword?: string;
  /** 提交人（模糊匹配用户名/昵称，仅管理端列表使用） */
  createdBy?: string;
  startTime?: string;
  endTime?: string;
}

function buildConditions(query: ListAsyncTasksQuery): SQL[] {
  const conditions: SQL[] = [];
  if (query.taskType) conditions.push(eq(asyncTasks.taskType, query.taskType));
  if (query.status) conditions.push(eq(asyncTasks.status, query.status));
  if (query.keyword) {
    const kw = `%${escapeLike(query.keyword)}%`;
    conditions.push(or(ilike(asyncTasks.title, kw), ilike(asyncTasks.taskType, kw))!);
  }
  const startTime = parseDateTimeInput(query.startTime);
  const endTime = parseDateTimeInput(query.endTime);
  if (startTime) conditions.push(gte(asyncTasks.createdAt, startTime));
  if (endTime) conditions.push(lte(asyncTasks.createdAt, endTime));
  return conditions;
}

/** 提交人筛选：先按用户名/昵称匹配用户，再按 createdBy 过滤；无匹配返回 null（调用方直接返回空列表） */
async function creatorCondition(createdBy: string): Promise<SQL | null> {
  const kw = `%${escapeLike(createdBy)}%`;
  const matched = await db.select({ id: users.id }).from(users)
    .where(or(ilike(users.username, kw), ilike(users.nickname, kw)))
    .limit(500);
  if (matched.length === 0) return null;
  return inArray(asyncTasks.createdBy, matched.map((row) => row.id));
}

async function queryTasks(conditions: SQL[], page: number, pageSize: number) {
  const where = conditions.length ? and(...conditions) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(asyncTasks, where),
    db.query.asyncTasks.findMany({
      where,
      with: { createdByUser: { columns: { nickname: true, username: true } } },
      orderBy: desc(asyncTasks.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  return { list: rows.map(mapAsyncTask), total, page, pageSize };
}

/** 管理端全局任务列表（任务中心页面） */
export async function listAsyncTasks(query: ListAsyncTasksQuery) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 10);
  const conditions = buildConditions(query);
  if (query.createdBy) {
    const cond = await creatorCondition(query.createdBy);
    if (!cond) return { list: [], total: 0, page, pageSize };
    conditions.push(cond);
  }
  return queryTasks(conditions, page, pageSize);
}

/** 当前用户自己的任务列表（业务页面进度展示） */
export async function listMyAsyncTasks(query: ListAsyncTasksQuery) {
  const user = currentUser();
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 10);
  const conditions = buildConditions(query);
  conditions.push(eq(asyncTasks.createdBy, user.userId));
  return queryTasks(conditions, page, pageSize);
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
  const row = await db.query.asyncTasks.findFirst({ where: eq(asyncTasks.id, id) });
  if (!row) throw new HTTPException(404, { message: '任务不存在' });
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
  if (!row) throw new HTTPException(404, { message: '任务不存在' });
  return mapAsyncTask(row);
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

const TERMINAL_STATUSES: AsyncTaskStatus[] = ['success', 'failed', 'cancelled'];

export async function deleteAsyncTask(id: number) {
  const row = await db.query.asyncTasks.findFirst({ where: eq(asyncTasks.id, id) });
  if (!row) throw new HTTPException(404, { message: '任务不存在' });
  if (!TERMINAL_STATUSES.includes(row.status)) {
    throw new HTTPException(400, { message: '进行中的任务不能删除，请先取消' });
  }
  await db.delete(asyncTasks).where(and(eq(asyncTasks.id, id), inArray(asyncTasks.status, ['success', 'failed', 'cancelled'])));
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
    .where(and(inArray(asyncTasks.id, ids), inArray(asyncTasks.status, ['success', 'failed', 'cancelled'])))
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
  const handler = listTaskHandlers().find((item) => item.taskType === taskType);
  if (!handler) throw new HTTPException(404, { message: '任务类型未注册' });
  return buildTaskTypeMeta(handler, await getTaskTypePolicy(taskType));
}

export interface ListTaskItemsQuery {
  page?: number;
  pageSize?: number;
  status?: AsyncTaskItemStatus;
  keyword?: string;
}

/** 任务项明细分页（创建者本人或管理员可见） */
export async function listAsyncTaskItems(taskId: number, query: ListTaskItemsQuery) {
  await ensureTaskAccessible(taskId, 'system:async-task:list');
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 10);
  const conditions: SQL[] = [eq(asyncTaskItems.taskId, taskId)];
  if (query.status) conditions.push(eq(asyncTaskItems.status, query.status));
  if (query.keyword) {
    const kw = `%${escapeLike(query.keyword)}%`;
    conditions.push(or(ilike(asyncTaskItems.itemKey, kw), ilike(asyncTaskItems.label, kw), ilike(asyncTaskItems.message, kw))!);
  }
  const where = and(...conditions);
  const [total, rows] = await Promise.all([
    db.$count(asyncTaskItems, where),
    db.select().from(asyncTaskItems).where(where)
      .orderBy(desc(asyncTaskItems.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);
  return {
    list: rows.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      itemKey: row.itemKey,
      label: row.label ?? null,
      status: row.status,
      message: row.message ?? null,
      data: row.data ?? null,
      attempt: row.attempt,
      createdAt: formatDateTime(row.createdAt),
      updatedAt: formatDateTime(row.updatedAt),
    })),
    total,
    page,
    pageSize,
  };
}

/** 任务中心统计概览（状态计数 + 近 24h 平均耗时 + 近 7 天趋势） */
export async function getAsyncTaskStats(): Promise<AsyncTaskStats> {
  const dayMs = 24 * 60 * 60 * 1000;
  const since24h = new Date(Date.now() - dayMs);
  const since7d = new Date(Date.now() - 7 * dayMs);
  const [statusRows, [duration], dailyRows] = await Promise.all([
    db.select({ status: asyncTasks.status, count: sql<number>`count(*)::int` })
      .from(asyncTasks).groupBy(asyncTasks.status),
    db.select({
      avgMs: sql<number | null>`avg(extract(epoch from (${asyncTasks.completedAt} - ${asyncTasks.startedAt})) * 1000)`,
    }).from(asyncTasks)
      .where(and(eq(asyncTasks.status, 'success'), gte(asyncTasks.completedAt, since24h))),
    db.select({
      date: sql<string>`to_char(${asyncTasks.createdAt}, 'YYYY-MM-DD')`,
      submitted: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${asyncTasks.status} = 'failed')::int`,
    }).from(asyncTasks)
      .where(gte(asyncTasks.createdAt, since7d))
      .groupBy(sql`to_char(${asyncTasks.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${asyncTasks.createdAt}, 'YYYY-MM-DD')`),
  ]);
  const counts: Record<string, number> = {};
  for (const row of statusRows) counts[row.status] = row.count;
  return {
    total: statusRows.reduce((sum, row) => sum + row.count, 0),
    pending: counts.pending ?? 0,
    running: counts.running ?? 0,
    success: counts.success ?? 0,
    failed: counts.failed ?? 0,
    cancelled: counts.cancelled ?? 0,
    avgDurationMs: duration?.avgMs != null ? Math.round(Number(duration.avgMs)) : null,
    daily: dailyRows.map((row) => ({ date: row.date, submitted: row.submitted, failed: row.failed })),
  };
}
