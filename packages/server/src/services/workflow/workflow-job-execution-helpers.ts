import { eq, sql, type SQL } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/pg-core';
import { db } from '../../db';
import { workflowJobExecutions, workflowJobs } from '../../db/schema';

/**
 * 作业执行记录 ⋈ 父作业：事件投递、触发器执行等「按执行记录列出 / 定位作业」查询的公共起点，
 * 调用方按需追加 `leftJoin` / `where` / 排序 / 分页。
 */
export function jobExecutionsWithJob<T extends SelectedFields>(projection: T) {
  return db.select(projection).from(workflowJobExecutions)
    .innerJoin(workflowJobs, eq(workflowJobExecutions.jobId, workflowJobs.id));
}

/** 作业执行记录 ⋈ 父作业 的计数（列表 `count` 公共实现） */
export function countJobExecutions(where: SQL | undefined): Promise<number> {
  return jobExecutionsWithJob({ c: sql<number>`count(*)::int` })
    .where(where)
    .then((r) => r[0]?.c ?? 0);
}
