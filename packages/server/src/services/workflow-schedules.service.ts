/**
 * 流程定时发起（T2-1）
 *
 * 按 cron 周期自动以指定发起人身份发起流程实例。
 * 调度由 registerSystemRecurringJob('workflow-schedule-tick') 每分钟触发 runDueWorkflowSchedules() 扫描执行。
 */
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { CronExpressionParser } from 'cron-parser';
import { db } from '../db';
import { workflowSchedules, workflowDefinitions, users } from '../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../lib/context';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { pageOffset } from '../lib/pagination';
import { formatDateTime, formatNullableDateTime, formatDate } from '../lib/datetime';
import logger from '../lib/logger';
import { createInstance } from './workflow-instances.service';
import type { WorkflowSchedule, CreateWorkflowScheduleInput, UpdateWorkflowScheduleInput } from '@zenith/shared';

type Row = typeof workflowSchedules.$inferSelect;

const TZ = 'Asia/Shanghai';

function mapSchedule(row: Row, extras: { definitionName?: string | null; initiatorName?: string | null } = {}): WorkflowSchedule {
  return {
    id: row.id,
    definitionId: row.definitionId,
    definitionName: extras.definitionName ?? null,
    name: row.name,
    cronExpression: row.cronExpression,
    initiatorId: row.initiatorId,
    initiatorName: extras.initiatorName ?? null,
    titleTemplate: row.titleTemplate ?? null,
    formData: (row.formData ?? null) as Record<string, unknown> | null,
    status: row.status,
    lastRunAt: formatNullableDateTime(row.lastRunAt),
    lastRunStatus: row.lastRunStatus ?? null,
    lastRunMessage: row.lastRunMessage ?? null,
    nextRunAt: formatNullableDateTime(row.nextRunAt),
    tenantId: row.tenantId,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function computeNextRun(cron: string, from: Date = new Date()): Date | null {
  try {
    return CronExpressionParser.parse(cron.trim(), { currentDate: from, tz: TZ }).next().toDate();
  } catch {
    return null;
  }
}

function renderTitle(template: string | null | undefined, fallback: string): string {
  const now = new Date();
  const base = template?.trim() || fallback;
  return base
    .replace(/\{\{\s*datetime\s*\}\}/g, formatDateTime(now))
    .replace(/\{\{\s*date\s*\}\}/g, formatDate(now));
}

async function ensureScheduleDefinitionLaunchable(definitionId: number): Promise<void> {
  const tc = tenantCondition(workflowDefinitions, currentUser());
  const conds = [eq(workflowDefinitions.id, definitionId)];
  if (tc) conds.push(tc);
  const [def] = await db
    .select({ id: workflowDefinitions.id, formType: workflowDefinitions.formType })
    .from(workflowDefinitions)
    .where(and(...conds))
    .limit(1);
  if (!def) throw new HTTPException(404, { message: '流程定义不存在' });
  if (def.formType === 'external') {
    throw new HTTPException(400, { message: '业务系统主导流程不能配置定时发起，请由业务模块按业务规则发起' });
  }
}

export async function listSchedules(query: { page?: number; pageSize?: number; definitionId?: number; status?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, definitionId, status } = query;
  const tc = tenantCondition(workflowSchedules, user);
  const conds = [];
  if (tc) conds.push(tc);
  if (definitionId) conds.push(eq(workflowSchedules.definitionId, definitionId));
  if (status) conds.push(eq(workflowSchedules.status, status as 'enabled' | 'disabled'));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(workflowSchedules, where),
    db.select({ row: workflowSchedules, definitionName: workflowDefinitions.name, initiatorName: users.nickname })
      .from(workflowSchedules)
      .leftJoin(workflowDefinitions, eq(workflowSchedules.definitionId, workflowDefinitions.id))
      .leftJoin(users, eq(workflowSchedules.initiatorId, users.id))
      .where(where)
      .orderBy(desc(workflowSchedules.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map((r) => mapSchedule(r.row, { definitionName: r.definitionName, initiatorName: r.initiatorName })), total, page, pageSize };
}

async function loadScheduleWithNames(id: number): Promise<WorkflowSchedule> {
  const [r] = await db.select({ row: workflowSchedules, definitionName: workflowDefinitions.name, initiatorName: users.nickname })
    .from(workflowSchedules)
    .leftJoin(workflowDefinitions, eq(workflowSchedules.definitionId, workflowDefinitions.id))
    .leftJoin(users, eq(workflowSchedules.initiatorId, users.id))
    .where(eq(workflowSchedules.id, id))
    .limit(1);
  if (!r) throw new HTTPException(404, { message: '定时规则不存在' });
  return mapSchedule(r.row, { definitionName: r.definitionName, initiatorName: r.initiatorName });
}

export async function createSchedule(input: CreateWorkflowScheduleInput): Promise<WorkflowSchedule> {
  const user = currentUser();
  await ensureScheduleDefinitionLaunchable(input.definitionId);
  if (computeNextRun(input.cronExpression) === null) {
    throw new HTTPException(400, { message: 'cron 表达式无效' });
  }
  const [row] = await db.insert(workflowSchedules).values({
    definitionId: input.definitionId,
    name: input.name,
    cronExpression: input.cronExpression,
    initiatorId: input.initiatorId,
    titleTemplate: input.titleTemplate ?? null,
    formData: input.formData ?? null,
    status: input.status ?? 'enabled',
    nextRunAt: (input.status ?? 'enabled') === 'enabled' ? computeNextRun(input.cronExpression) : null,
    tenantId: getCreateTenantId(user),
  }).returning();
  return loadScheduleWithNames(row.id);
}

export async function updateSchedule(id: number, input: UpdateWorkflowScheduleInput): Promise<WorkflowSchedule> {
  const tc = tenantCondition(workflowSchedules, currentUser());
  const conds = [eq(workflowSchedules.id, id)];
  if (tc) conds.push(tc);
  const [existing] = await db.select().from(workflowSchedules).where(and(...conds)).limit(1);
  if (!existing) throw new HTTPException(404, { message: '定时规则不存在' });
  const patch: Partial<typeof workflowSchedules.$inferInsert> = {};
  if (input.definitionId !== undefined) {
    await ensureScheduleDefinitionLaunchable(input.definitionId);
    patch.definitionId = input.definitionId;
  }
  if (input.name !== undefined) patch.name = input.name;
  if (input.initiatorId !== undefined) patch.initiatorId = input.initiatorId;
  if (input.titleTemplate !== undefined) patch.titleTemplate = input.titleTemplate ?? null;
  if (input.formData !== undefined) patch.formData = input.formData ?? null;
  const nextCron = input.cronExpression ?? existing.cronExpression;
  if (input.cronExpression !== undefined) {
    if (computeNextRun(input.cronExpression) === null) throw new HTTPException(400, { message: 'cron 表达式无效' });
    patch.cronExpression = input.cronExpression;
  }
  const nextStatus = input.status ?? existing.status;
  if (input.status !== undefined) patch.status = input.status;
  // 重新计算 nextRunAt：启用时按（可能更新的）cron 计算，停用时清空
  patch.nextRunAt = nextStatus === 'enabled' ? computeNextRun(nextCron) : null;
  const [row] = await db.update(workflowSchedules).set(patch).where(eq(workflowSchedules.id, id)).returning();
  return loadScheduleWithNames(row.id);
}

export async function deleteSchedule(id: number): Promise<void> {
  const tc = tenantCondition(workflowSchedules, currentUser());
  const conds = [eq(workflowSchedules.id, id)];
  if (tc) conds.push(tc);
  const [existing] = await db.select({ id: workflowSchedules.id }).from(workflowSchedules).where(and(...conds)).limit(1);
  if (!existing) throw new HTTPException(404, { message: '定时规则不存在' });
  await db.delete(workflowSchedules).where(eq(workflowSchedules.id, id));
}

/** 立即执行一次（手动触发，不影响 nextRunAt） */
export async function runScheduleNow(id: number): Promise<WorkflowSchedule> {
  const tc = tenantCondition(workflowSchedules, currentUser());
  const conds = [eq(workflowSchedules.id, id)];
  if (tc) conds.push(tc);
  const [s] = await db.select().from(workflowSchedules).where(and(...conds)).limit(1);
  if (!s) throw new HTTPException(404, { message: '定时规则不存在' });
  await fireSchedule(s);
  return loadScheduleWithNames(id);
}

/** 单条定时规则执行：以 initiator 身份发起实例，并回写运行状态 */
async function fireSchedule(s: Row): Promise<void> {
  const now = new Date();
  try {
    const [u] = await db.select({ username: users.username, tenantId: users.tenantId }).from(users).where(eq(users.id, s.initiatorId)).limit(1);
    if (!u) throw new Error('发起人不存在');
    const title = renderTitle(s.titleTemplate, s.name);
    await createInstance(
      { definitionId: s.definitionId, title, formData: (s.formData ?? {}) as Record<string, unknown> },
      { userId: s.initiatorId, username: u.username, tenantId: s.tenantId ?? u.tenantId ?? null, roles: [] },
    );
    await db.update(workflowSchedules).set({
      lastRunAt: now,
      lastRunStatus: 'success',
      lastRunMessage: `已发起：${title}`,
    }).where(eq(workflowSchedules.id, s.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[workflow-schedule] fire failed', { scheduleId: s.id, err: msg });
    await db.update(workflowSchedules).set({
      lastRunAt: now,
      lastRunStatus: 'fail',
      lastRunMessage: msg.slice(0, 512),
    }).where(eq(workflowSchedules.id, s.id));
  }
}

/** 调度器每分钟调用：扫描到期的启用规则并发起，随后推进 nextRunAt */
export async function runDueWorkflowSchedules(): Promise<void> {
  const now = new Date();
  const due = await db.select().from(workflowSchedules).where(and(
    eq(workflowSchedules.status, 'enabled'),
    sql`${workflowSchedules.nextRunAt} is not null`,
    lte(workflowSchedules.nextRunAt, now),
  ));
  for (const s of due) {
    await fireSchedule(s);
    const next = computeNextRun(s.cronExpression, new Date());
    await db.update(workflowSchedules).set({ nextRunAt: next }).where(eq(workflowSchedules.id, s.id));
  }
}
