import type { QueryOutputOf } from '@zenith/shared/core';
import type { asyncTaskContract } from '@zenith/shared/tasks';
import { desc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../../../db';
import { asyncTasks, users } from '../../../db/schema';
import { buildListResult, emptyListResult } from '../../../lib/list-query';
import { mapAsyncTask } from '../../../lib/task-center/map';
import { asyncTaskStatusCondition } from '../../../lib/task-center/status-filter';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../../lib/where-helpers';
import { asyncTaskScopedWhere } from './access';

type AsyncTaskListFilter = Omit<QueryOutputOf<typeof asyncTaskContract.list>, 'page' | 'pageSize'>;

export const asyncTaskWithCreator = {
  ...getTableColumns(asyncTasks),
  createdByUser: { nickname: users.nickname, username: users.username },
};

function buildAsyncTaskWhere(query: AsyncTaskListFilter, scope: SQL, creator?: SQL): SQL | undefined {
  return buildWhere(
    query.taskType ? eq(asyncTasks.taskType, query.taskType) : undefined,
    query.taskTypes ? inArray(asyncTasks.taskType, query.taskTypes) : undefined,
    asyncTaskStatusCondition(query.status),
    keywordCondition(query.keyword, [asyncTasks.title, asyncTasks.taskType], 'ilike'),
    keywordCondition(query.content, [sql`(${asyncTasks.payload} - 'configurationCapture' - 'configurationCaptures')::text`, sql`${asyncTasks.result}::text`], 'ilike'),
    ...dateRangeConditions(asyncTasks.createdAt, query.startTime, query.endTime),
    scope,
    creator,
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
    rows: () => withPagination(db.select(asyncTaskWithCreator).from(asyncTasks)
      .leftJoin(users, eq(users.id, asyncTasks.createdBy))
      .where(where).orderBy(desc(asyncTasks.id)).$dynamic(), page, pageSize),
    map: mapAsyncTask,
  });
}

/** 任务中心列表与计数使用同一访问范围。 */
export async function listAsyncTasks(query: QueryOutputOf<typeof asyncTaskContract.list>) {
  const { page, pageSize } = query;
  let extra: SQL | undefined;
  if (query.createdBy) {
    const cond = await creatorCondition(query.createdBy);
    if (!cond) return emptyListResult(page, pageSize);
    extra = cond;
  }
  return queryTasks(buildAsyncTaskWhere(query, await asyncTaskScopedWhere(), extra), page, pageSize);
}

/** 当前用户自己的任务列表（业务页面进度展示） */
export async function listMyAsyncTasks(query: QueryOutputOf<typeof asyncTaskContract.mine>) {
  const { page, pageSize } = query;
  return queryTasks(buildAsyncTaskWhere(query, await asyncTaskScopedWhere('own')), page, pageSize);
}
