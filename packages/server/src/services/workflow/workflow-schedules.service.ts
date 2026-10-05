import { workflowScheduleContract } from '@zenith/shared/workflow';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * 流程定时发起（T2-1）
 *
 * 按 cron 周期自动以指定发起人身份发起流程实例。
 * 调度由系统启动任务 workflow-schedule-tick 每分钟触发 runDueWorkflowSchedules() 扫描执行。
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { db } from '../../db';
import { workflowSchedules, workflowDefinitions, users } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { formatDate, formatDateTime, formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import type { WorkflowSchedule, CreateWorkflowScheduleInput, UpdateWorkflowScheduleInput } from '@zenith/shared/workflow';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { collectScheduledJobs, listOverdueScheduledJobs, type ScheduledMonitorQuery } from '../../lib/job-monitor/scheduled';
import type { DbExecutor } from '../../db/types';
import { enqueueJob } from '../../lib/workflow-jobs/engine';
import { workflowTransaction } from '../../lib/workflow-jobs/lease';
import { computeWorkflowScheduleNextRun as computeNextRun, planWorkflowScheduleUpdate } from './workflow-schedule-planning';

export function workflowScheduleDueCondition(asOf: Date) {
  return and(eq(workflowSchedules.status, 'enabled'), sql`${workflowSchedules.nextRunAt} is not null`, lte(workflowSchedules.nextRunAt, asOf));
}

const scheduledMonitor: ScheduledMonitorQuery = {
  key: 'workflow-schedule', label: '流程定时触发', table: workflowSchedules, due: workflowScheduleDueCondition,
  id: workflowSchedules.id, title: workflowSchedules.name, status: workflowSchedules.status,
  dueAt: workflowSchedules.nextRunAt, dateColumn: workflowSchedules.nextRunAt,
  drillDown: { path: '/workflow/schedules', label: '查看定时发起' },
};

export function getWorkflowScheduledHealth() { return collectScheduledJobs(scheduledMonitor); }
export function listOverdueWorkflowScheduled(limit: number) { return listOverdueScheduledJobs(scheduledMonitor, limit); }

type Row = typeof workflowSchedules.$inferSelect;

function mapSchedule(row: Row, extras: { definitionName?: string | null; initiatorName?: string | null } = {}): WorkflowSchedule {
  return {
    id: row.id,
    definitionId: row.definitionId,
    definitionName: extras.definitionName ?? null,
    name: row.name,
    cronExpression: row.cronExpression,
    timezone: row.timezone ?? null,
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
    ...formatTimestamps(row),
  };
}

function renderTitle(template: string | null | undefined, fallback: string, scheduledAt: Date): string {
  const base = template?.trim() || fallback;
  return base
    .replace(/\{\{\s*datetime\s*\}\}/g, formatDateTime(scheduledAt))
    .replace(/\{\{\s*date\s*\}\}/g, formatDate(scheduledAt));
}

async function ensureScheduleDefinitionLaunchable(definitionId: number): Promise<void> {
  const [def] = await db
    .select({ id: workflowDefinitions.id, formType: workflowDefinitions.formType })
    .from(workflowDefinitions)
    .where(buildWhere(eq(workflowDefinitions.id, definitionId), tenantCondition(workflowDefinitions, currentUser())))
    .limit(1);
  requireRow(def, '流程定义不存在');
  if (def.formType === 'external') {
    throw new HTTPException(400, { message: '业务系统主导流程不能配置定时发起，请由业务模块按业务规则发起' });
  }
}

/** 按 id 定位当前租户可见的定时规则 */
function findSchedule(id: number) {
  return buildWhere(eq(workflowSchedules.id, id), tenantCondition(workflowSchedules, currentUser()));
}

export async function listSchedules(query: QueryOutputOf<typeof workflowScheduleContract.list>) {
  const user = currentUser();
  const { page, pageSize, definitionId, status } = query;
  const where = buildWhere(
    tenantCondition(workflowSchedules, user),
    definitionId ? eq(workflowSchedules.definitionId, definitionId) : undefined,
    status ? eq(workflowSchedules.status, status as 'enabled' | 'disabled') : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(workflowSchedules, where),
    rows: () => withPagination(db.select({ row: workflowSchedules, definitionName: workflowDefinitions.name, initiatorName: users.nickname })
      .from(workflowSchedules)
      .leftJoin(workflowDefinitions, eq(workflowSchedules.definitionId, workflowDefinitions.id))
      .leftJoin(users, eq(workflowSchedules.initiatorId, users.id))
      .where(where)
      .orderBy(desc(workflowSchedules.id)).$dynamic(), page, pageSize),
    map: (r) => mapSchedule(r.row, { definitionName: r.definitionName, initiatorName: r.initiatorName }),
  });
}

/** 定时规则（含流程 / 发起人名称）；不存在 404 */
export async function getWorkflowSchedule(id: number): Promise<WorkflowSchedule> {
  const [r] = await db.select({ row: workflowSchedules, definitionName: workflowDefinitions.name, initiatorName: users.nickname })
    .from(workflowSchedules)
    .leftJoin(workflowDefinitions, eq(workflowSchedules.definitionId, workflowDefinitions.id))
    .leftJoin(users, eq(workflowSchedules.initiatorId, users.id))
    .where(buildWhere(eq(workflowSchedules.id, id), tenantCondition(workflowSchedules, currentUser())))
    .limit(1);
  requireRow(r, '定时规则不存在');
  return mapSchedule(r.row, { definitionName: r.definitionName, initiatorName: r.initiatorName });
}

export async function createSchedule(input: CreateWorkflowScheduleInput): Promise<WorkflowSchedule> {
  const user = currentUser();
  await ensureScheduleDefinitionLaunchable(input.definitionId);
  if (computeNextRun(input.cronExpression, input.timezone) === null) {
    throw new HTTPException(400, { message: 'cron 表达式或时区无效' });
  }
  const [row] = await db.insert(workflowSchedules).values({
    definitionId: input.definitionId,
    name: input.name,
    cronExpression: input.cronExpression,
    timezone: input.timezone?.trim() || null,
    initiatorId: input.initiatorId,
    titleTemplate: input.titleTemplate ?? null,
    formData: input.formData ?? null,
    status: input.status ?? 'enabled',
    nextRunAt: (input.status ?? 'enabled') === 'enabled' ? computeNextRun(input.cronExpression, input.timezone) : null,
    tenantId: getCreateTenantId(user),
  }).returning();
  return getWorkflowSchedule(row.id);
}

export async function updateSchedule(id: number, input: UpdateWorkflowScheduleInput): Promise<WorkflowSchedule> {
  if (input.definitionId !== undefined) {
    await ensureScheduleDefinitionLaunchable(input.definitionId);
  }
  // Share the same row lock as the due scanner: a stale form save cannot undo a claim.
  await workflowTransaction(async (tx) => {
    const [existing] = await tx.select().from(workflowSchedules).where(findSchedule(id)).limit(1).for('update');
    requireRow(existing, '定时规则不存在');
    const { patch, preserveDue } = planWorkflowScheduleUpdate(existing, input);
    if (preserveDue) await enqueueScheduleOccurrence(existing, existing.nextRunAt!, 'scheduled', tx);
    if (Object.keys(patch).length) await tx.update(workflowSchedules).set(patch).where(eq(workflowSchedules.id, id));
  });
  return getWorkflowSchedule(id);
}

export async function deleteSchedule(id: number): Promise<void> {
  const [existing] = await db.select({ id: workflowSchedules.id }).from(workflowSchedules).where(findSchedule(id)).limit(1);
  requireRow(existing, '定时规则不存在');
  await db.delete(workflowSchedules).where(eq(workflowSchedules.id, id));
}

/** 立即执行一次（手动触发，不影响 nextRunAt） */
export async function runScheduleNow(id: number): Promise<WorkflowSchedule> {
  await workflowTransaction(async (tx) => {
    const [s] = await tx.select().from(workflowSchedules).where(findSchedule(id)).limit(1).for('update');
    requireRow(s, '定时规则不存在');
    await enqueueScheduleOccurrence(s, new Date(), 'manual', tx);
  });
  return getWorkflowSchedule(id);
}

/** Immutable occurrence snapshot; retries keep the original date/title/form/initiator. */
export async function enqueueScheduleOccurrence(s: Row, scheduledAt: Date, trigger: 'scheduled' | 'manual', executor: DbExecutor) {
  return enqueueJob({
    jobType: 'schedule_launch',
    idempotencyKey: trigger === 'scheduled' ? `schedule:${s.id}:${scheduledAt.toISOString()}` : `schedule:${s.id}:manual:${randomUUID()}`,
    payload: { scheduleId: s.id, definitionId: s.definitionId, initiatorId: s.initiatorId,
      title: renderTitle(s.titleTemplate, s.name, scheduledAt), formData: s.formData ?? {},
      scheduledAt: scheduledAt.toISOString(), trigger },
    tenantId: s.tenantId, maxAttempts: 5, runAt: scheduledAt,
  }, executor);
}

/** Atomically journal each due occurrence and advance its plan. Execution belongs to the ledger worker. */
export async function runDueWorkflowSchedules(): Promise<void> {
  const now = new Date();
  const deadline = Date.now() + 5000;
  let remaining = 100;
  // Small rounds give every selected rule an occurrence before revisiting a backlog.
  // Retain a finite occurrence/time budget even after a long worker outage.
  while (remaining > 0 && Date.now() < deadline) {
    const processed = await workflowTransaction(async (tx) => {
      const due = await tx.select().from(workflowSchedules).where(workflowScheduleDueCondition(now))
        .orderBy(asc(workflowSchedules.nextRunAt), asc(workflowSchedules.id)).limit(Math.min(20, remaining)).for('update', { skipLocked: true });
      let count = 0;
      for (const s of due) {
        if (Date.now() >= deadline) break;
        await enqueueScheduleOccurrence(s, s.nextRunAt!, 'scheduled', tx);
        await tx.update(workflowSchedules)
          .set({ nextRunAt: computeNextRun(s.cronExpression, s.timezone, s.nextRunAt!) })
          .where(eq(workflowSchedules.id, s.id));
        count += 1;
      }
      return count;
    });
    if (!processed) break;
    remaining -= processed;
  }
}
