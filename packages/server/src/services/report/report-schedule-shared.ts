import { CronExpressionParser } from 'cron-parser';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { roles, userRoles, users } from '../../db/schema';

/**
 * 报表定时规则（质量检查 / SLA 评估）共用的调度辅助：
 * 定时派发在无请求上下文的 cron 里运行，需要以规则创建者身份提交异步任务。
 */

/** 以规则创建者身份执行所需的用户上下文（`runWithCurrentUser` 入参）；用户不存在返回 null */
export async function loadScheduleActor(userId: number) {
  const [user] = await db.select({ id: users.id, username: users.username, tenantId: users.tenantId })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  const roleRows = await db.select({ code: roles.code }).from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  return { userId: user.id, username: user.username, tenantId: user.tenantId, roles: roleRows.map((row) => row.code) };
}

/**
 * 按 cron 判定规则是否到期：返回「上一次应触发时刻」（用作幂等键）；
 * cron 非法，或该时刻已执行过（`lastRunAt >= previous`）返回 null。
 */
export function dueCronFireTime(rule: { cron: string; timezone: string; lastRunAt: Date | null }, now: Date): Date | null {
  let previous: Date;
  try {
    previous = CronExpressionParser.parse(rule.cron, { currentDate: now, tz: rule.timezone }).prev().toDate();
  } catch {
    return null;
  }
  if (rule.lastRunAt && rule.lastRunAt >= previous) return null;
  return previous;
}
