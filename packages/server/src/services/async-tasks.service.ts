import { and, desc, eq, gte, ilike, inArray, lte, or, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { AsyncTaskStatus } from '@zenith/shared';
import { db } from '../db';
import { asyncTasks } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { escapeLike } from '../lib/where-helpers';
import { parseDateTimeInput } from '../lib/datetime';
import { currentUser, hasPermission } from '../lib/context';
import {
  cleanupAsyncTasks,
  listTaskTypeMetas,
  mapAsyncTask,
  requestCancelAsyncTask,
  restartAsyncTask,
  resumeAsyncTask,
} from '../lib/task-center';

export interface ListAsyncTasksQuery {
  page?: number;
  pageSize?: number;
  taskType?: string;
  status?: AsyncTaskStatus;
  keyword?: string;
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
  return queryTasks(buildConditions(query), page, pageSize);
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
async function ensureTaskAccessible(id: number, permission: 'system:async-task:list' | 'system:async-task:manage') {
  const row = await db.query.asyncTasks.findFirst({ where: eq(asyncTasks.id, id) });
  if (!row) throw new HTTPException(404, { message: '任务不存在' });
  const user = currentUser();
  if (row.createdBy !== user.userId && !(await hasPermission(permission))) {
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

export async function cleanupFinishedTasks() {
  const cleaned = await cleanupAsyncTasks();
  return { cleaned };
}

export function listAsyncTaskTypes() {
  return listTaskTypeMetas();
}
