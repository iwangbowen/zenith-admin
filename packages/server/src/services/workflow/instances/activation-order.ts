import { and, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowNodeActivations } from '../../../db/schema';

/**
 * 「在本 activation 之后进入的节点轮次」判定条件：与 activation 自身的 created_at 做 SQL 侧同列比较。
 *
 * 不要改回 JS 侧比较（`gt(workflowNodeActivations.createdAt, entered.createdAt)`）：
 * created_at 是无时区 timestamp，库内为微秒精度（defaultNow），经 JS Date 往返只剩毫秒精度，
 * 回传参数时被截断，严格 `>` 会让本 activation 自身命中「后续节点」——已办任务撤回因此恒报
 * 400「后续节点已被处理」；原始驱动读回还会按进程本地时区解析该列，回传 Date 再叠加时区偏移。
 */
export function laterActivationsWhere(instanceId: number, activationId: string): SQL {
  const enteredAt = db.select({ at: workflowNodeActivations.createdAt }).from(workflowNodeActivations)
    .where(eq(workflowNodeActivations.id, activationId));
  return and(
    eq(workflowNodeActivations.instanceId, instanceId),
    sql`${workflowNodeActivations.createdAt} > ${enteredAt}`,
  ) as SQL;
}
