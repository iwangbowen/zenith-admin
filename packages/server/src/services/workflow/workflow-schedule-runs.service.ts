import { desc, eq, sql } from 'drizzle-orm';
import { workflowScheduleContract, workflowScheduleRunSchema, type WorkflowScheduleRun, type WorkflowScheduleLaunchPayload } from '@zenith/shared/workflow';
import type { QueryOutputOf } from '@zenith/shared/core';
import { db } from '../../db';
import { workflowJobs, workflowInstances, type WorkflowJobRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { buildListResult } from '../../lib/list-query';
import { pickEntity } from '../../lib/entity-map';
import { requireRow } from '../../lib/db-assert';
import { formatDateTime } from '../../lib/datetime';
import { getWorkflowSchedule } from './workflow-schedules.service';
import { getWorkflowJobDetail } from './workflow-jobs.service';
import { retryJob } from '../../lib/workflow-jobs/engine';

function occurrenceWhere(scheduleId: number, jobId?: number) {
  return buildWhere(eq(workflowJobs.jobType, 'schedule_launch'),
    sql`${workflowJobs.payload}->>'scheduleId' = ${String(scheduleId)}`,
    jobId !== undefined ? eq(workflowJobs.id, jobId) : undefined,
    tenantCondition(workflowJobs, currentUser()));
}

function mapRun(row: WorkflowJobRow, definitionName: string | null, instanceTitle: string | null): WorkflowScheduleRun {
  const payload = row.payload as WorkflowScheduleLaunchPayload;
  return pickEntity(workflowScheduleRunSchema, row, {
    payload: row.payload as Record<string, unknown>, result: row.result as Record<string, unknown> | null,
    instanceTitle, definitionName, scheduleId: payload.scheduleId,
    scheduledAt: formatDateTime(new Date(payload.scheduledAt)), trigger: payload.trigger,
  });
}

export async function listScheduleRuns(scheduleId: number, query: QueryOutputOf<typeof workflowScheduleContract.runs>) {
  const schedule = await getWorkflowSchedule(scheduleId);
  const where = occurrenceWhere(scheduleId);
  const { page, pageSize } = query;
  return buildListResult({ page, pageSize,
    count: () => db.$count(workflowJobs, where),
    rows: () => withPagination(db.select({ job: workflowJobs, instanceTitle: workflowInstances.title })
      .from(workflowJobs).leftJoin(workflowInstances, eq(workflowInstances.id, workflowJobs.instanceId))
      .where(where).orderBy(desc(workflowJobs.id)).$dynamic(), page, pageSize),
    map: (r) => mapRun(r.job, schedule.definitionName ?? null, r.instanceTitle),
  });
}

export async function getScheduleRun(scheduleId: number, jobId: number) {
  const schedule = await getWorkflowSchedule(scheduleId);
  const [row] = await db.select({ job: workflowJobs, instanceTitle: workflowInstances.title })
    .from(workflowJobs).leftJoin(workflowInstances, eq(workflowInstances.id, workflowJobs.instanceId))
    .where(occurrenceWhere(scheduleId, jobId)).limit(1);
  requireRow(row, '定时执行记录不存在');
  const detail = await getWorkflowJobDetail(jobId);
  return { ...mapRun(row.job, schedule.definitionName ?? null, row.instanceTitle), executions: detail.executions };
}

/** Reuse the same immutable occurrence/operation; completed launches are never cloned by replay. */
export async function retryScheduleRun(scheduleId: number, jobId: number) {
  await getScheduleRun(scheduleId, jobId);
  requireRow(await retryJob(jobId), '仅失败、死信或已取消的定时执行可补发', 400);
  return getScheduleRun(scheduleId, jobId);
}
