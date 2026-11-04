import type { QueryOutputOf } from '@zenith/shared/core';
import type { asyncTaskContract } from '@zenith/shared/tasks';
import { desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../../../db';
import { asyncTasks, users } from '../../../db/schema';
import { currentUser } from '../../../lib/context';
import { buildListResult, emptyListResult } from '../../../lib/list-query';
import { pageOffset } from '../../../lib/pagination';
import { mapAsyncTask } from '../../../lib/task-center/map';
import { asyncTaskStatusCondition } from '../../../lib/task-center/status-filter';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../../lib/where-helpers';

type AsyncTaskListFilter = Omit<QueryOutputOf<typeof asyncTaskContract.list>, 'page' | 'pageSize'>;

function buildAsyncTaskWhere(query: AsyncTaskListFilter, extra?: SQL): SQL | undefined {
  return buildWhere(
    query.taskType ? eq(asyncTasks.taskType, query.taskType) : undefined,
    query.taskTypes ? inArray(asyncTasks.taskType, query.taskTypes) : undefined,
    asyncTaskStatusCondition(query.status),
    keywordCondition(query.keyword, [asyncTasks.title, asyncTasks.taskType], 'ilike'),
    keywordCondition(query.content, [sql`(${asyncTasks.payload} - 'configurationCapture' - 'configurationCaptures')::text`, sql`${asyncTasks.result}::text`], 'ilike'),
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
    if (!cond) return emptyListResult(page, pageSize);
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
