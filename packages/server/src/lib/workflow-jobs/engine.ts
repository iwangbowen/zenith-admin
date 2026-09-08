import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { and, asc, eq, gt, inArray, isNull, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { WorkflowJobType } from '@zenith/shared/workflow';
import { db } from '../../db';
import { workflowJobs, workflowJobExecutions, type WorkflowJobRow, type NewWorkflowJob } from '../../db/schema';
import type { DbExecutor, DbTransaction } from '../../db/types';
import { registerSystemQueueWorker } from '../pg-boss-scheduler';
import { currentTraceId, currentParentRef, runWithTraceId, runWithParentRef } from '../context';
import { formatDateTime } from '../datetime';
import { WORKFLOW_JOB_QUEUE, WORKFLOW_JOB_LEASE_MS, WORKFLOW_JOB_HEARTBEAT_MS, WORKFLOW_JOB_EXECUTION_TIMEOUT_MS, type WorkflowJobContext, type WorkflowJobResult } from './types';
import { WorkflowJobSkip, WorkflowJobPermanentError, WorkflowJobError, WorkflowJobLeaseLostError, WorkflowJobDeadlineError } from './errors';
import { computeBackoffMs } from './backoff';
import { getJobHandler } from './registry';
import { isIndeterminateExternalStatus } from './external-effects';
import { currentWorkflowJobContext, ownedJobCondition, runWithWorkflowJobContext } from './lease';
import { flushWorkflowJobEffects } from './execution-context';
import { publishWorkflowJobPickup, rememberWorkflowJobPickup, scheduleJobPickup } from './publication';
export { scheduleJobPickup, flushWorkflowJobPickups } from './publication';
export { WORKFLOW_ADVANCING_JOB_TYPES } from '@zenith/shared/workflow';

const WORKER_ID = `${hostname()}:${process.pid}`.slice(0, 64);
const clearedLease = { leaseToken: null, leaseUntil: null, executionDeadline: null, lockedAt: null, lockedBy: null };
const dbNow = sql`clock_timestamp()`;

export interface EnqueueJobInput {
  jobType: WorkflowJobType;
  payload?: Record<string, unknown>;
  instanceId?: number | null;
  taskId?: number | null;
  nodeKey?: string | null;
  idempotencyKey?: string | null;
  traceId?: string | null;
  priority?: number;
  maxAttempts?: number;
  executionTimeoutMs?: number;
  runAt?: Date;
  tenantId?: number | null;
}

/** Transactional callers persist only; reconciliation covers a missed post-commit wakeup. */
export async function enqueueJob(input: EnqueueJobInput, executor: DbExecutor = db): Promise<WorkflowJobRow | null> {
  const values: NewWorkflowJob = {
    jobType: input.jobType, status: 'pending', payload: input.payload ?? {},
    instanceId: input.instanceId ?? null, taskId: input.taskId ?? null, nodeKey: input.nodeKey ?? null,
    idempotencyKey: input.idempotencyKey ?? null, traceId: input.traceId ?? currentTraceId() ?? null,
    parentRef: currentParentRef() ?? null, priority: input.priority ?? 100,
    maxAttempts: input.maxAttempts ?? 1, runAt: input.runAt ?? new Date(), tenantId: input.tenantId ?? null,
    executionTimeoutMs: Math.max(1, Math.min(input.executionTimeoutMs ?? WORKFLOW_JOB_EXECUTION_TIMEOUT_MS, 3_600_000)),
  };
  const insertion = executor.insert(workflowJobs).values(values);
  const [row] = input.idempotencyKey
    ? await insertion.onConflictDoNothing({ target: workflowJobs.idempotencyKey }).returning()
    : await insertion.returning();
  if (row) {
    if (executor === db) scheduleJobPickup(row.id, row.runAt);
    else rememberWorkflowJobPickup(executor, row.id, row.runAt);
  }
  return row ?? null;
}


async function closeExecution(tx: DbExecutor, token: string | null, status: 'succeeded' | 'failed', detail: WorkflowJobResult & { errorMessage?: string | null } = {}) {
  if (!token) return;
  await tx.update(workflowJobExecutions).set({
    status, finishedAt: dbNow,
    durationMs: sql`greatest(0, floor(extract(epoch from (clock_timestamp() - ${workflowJobExecutions.startedAt})) * 1000))::integer`,
    ...(detail.requestUrl !== undefined ? { requestUrl: detail.requestUrl } : {}),
    ...(detail.requestMethod !== undefined ? { requestMethod: detail.requestMethod } : {}),
    ...(detail.requestBody !== undefined ? { requestBody: detail.requestBody } : {}),
    ...(detail.responseStatus !== undefined ? { responseStatus: detail.responseStatus } : {}),
    ...(detail.responseBody !== undefined ? { responseBody: detail.responseBody } : {}),
    errorMessage: detail.errorMessage?.slice(0, 2048) ?? null,
  }).where(and(eq(workflowJobExecutions.leaseToken, token), eq(workflowJobExecutions.status, 'running')));
}

async function hasUncertainExternalEffect(tx: DbExecutor, token: string | null, responseStatus?: number | null): Promise<boolean> {
  if (!token) return false;
  const [execution] = await tx.select({ method: workflowJobExecutions.requestMethod }).from(workflowJobExecutions)
    .where(eq(workflowJobExecutions.leaseToken, token)).limit(1);
  return !!execution?.method
    && !['GET', 'HEAD', 'OPTIONS'].includes(execution.method.toUpperCase())
    && isIndeterminateExternalStatus(responseStatus);
}

export async function cancelJobs(
  filter: { taskId?: number; instanceId?: number; jobType?: WorkflowJobType; jobTypes?: readonly WorkflowJobType[] },
  executor: DbExecutor = db,
): Promise<number> {
  if (executor === db) return db.transaction((tx) => cancelJobs(filter, tx));
  const conds: SQL[] = [inArray(workflowJobs.status, ['pending', 'running', 'paused'])];
  if (filter.taskId != null) conds.push(eq(workflowJobs.taskId, filter.taskId));
  if (filter.instanceId != null) conds.push(eq(workflowJobs.instanceId, filter.instanceId));
  if (filter.jobType != null) conds.push(eq(workflowJobs.jobType, filter.jobType));
  if (filter.jobTypes?.length) conds.push(inArray(workflowJobs.jobType, [...filter.jobTypes]));
  if (conds.length === 1) return 0;
  // Completing an instance cancels other advancing jobs; its current owner finishes normally.
  const current = currentWorkflowJobContext();
  if (current && !current.signal.aborted) conds.push(ne(workflowJobs.id, current.job.id));
  const jobs = await executor.select({ id: workflowJobs.id, leaseToken: workflowJobs.leaseToken }).from(workflowJobs)
    .where(and(...conds)).orderBy(asc(workflowJobs.id)).for('update');
  if (!jobs.length) return 0;
  await executor.update(workflowJobs).set({ status: 'canceled', generation: sql`${workflowJobs.generation} + 1`, pausedRemainingMs: null, ...clearedLease })
    .where(inArray(workflowJobs.id, jobs.map((job) => job.id)));
  for (const job of jobs) await closeExecution(executor, job.leaseToken, 'failed', { errorMessage: 'Job canceled' });
  return jobs.length;
}

export async function pauseInstanceJobs(tx: DbExecutor, instanceId: number, jobTypes: readonly WorkflowJobType[]): Promise<void> {
  const jobs = await tx.select({
    id: workflowJobs.id,
    status: workflowJobs.status,
    generation: workflowJobs.generation,
    leaseToken: workflowJobs.leaseToken,
  }).from(workflowJobs)
    .where(and(eq(workflowJobs.instanceId, instanceId), inArray(workflowJobs.jobType, [...jobTypes]),
      inArray(workflowJobs.status, ['pending', 'running']))).orderBy(asc(workflowJobs.id)).for('update');
  if (!jobs.length) return;
  for (const job of jobs) {
    const uncertain = job.status === 'running' && await hasUncertainExternalEffect(tx, job.leaseToken);
    const message = uncertain
      ? '外部操作结果待确认：实例挂起时外部写请求仍在执行或结果未知'
      : 'Instance paused';
    await tx.update(workflowJobs).set(uncertain ? {
      status: 'dead', generation: sql`${workflowJobs.generation} + 1`,
      pausedRemainingMs: null, lastError: message, ...clearedLease,
    } : {
      attempts: sql`greatest(${workflowJobs.attempts} - case when ${workflowJobs.status} = 'running' then 1 else 0 end, 0)`,
      status: 'paused', generation: sql`${workflowJobs.generation} + 1`, ...clearedLease,
      pausedRemainingMs: sql`greatest(0, floor(extract(epoch from (${workflowJobs.runAt} - clock_timestamp())) * 1000))::bigint`,
    }).where(and(
      eq(workflowJobs.id, job.id),
      eq(workflowJobs.generation, job.generation),
      eq(workflowJobs.status, job.status),
    ));
    await closeExecution(tx, job.leaseToken, 'failed', { errorMessage: message });
  }
}

export async function resumeInstanceJobs(tx: DbExecutor, instanceId: number, jobTypes: readonly WorkflowJobType[]) {
  return tx.update(workflowJobs).set({
    status: 'pending', generation: sql`${workflowJobs.generation} + 1`, ...clearedLease,
    runAt: sql`clock_timestamp() + coalesce(${workflowJobs.pausedRemainingMs}, 0) * interval '1 millisecond'`,
    pausedRemainingMs: null,
  }).where(and(eq(workflowJobs.instanceId, instanceId), inArray(workflowJobs.jobType, [...jobTypes]), eq(workflowJobs.status, 'paused')))
    .returning({ id: workflowJobs.id, runAt: workflowJobs.runAt });
}

export async function retryJob(id: number, opts?: { payload?: Record<string, unknown>; runAt?: Date }): Promise<WorkflowJobRow | null> {
  const [row] = await db.update(workflowJobs).set({
    status: 'pending', generation: sql`${workflowJobs.generation} + 1`, attempts: 0,
    lastError: null, result: null, pausedRemainingMs: null, ...clearedLease, runAt: opts?.runAt ?? new Date(),
    ...(opts?.payload ? { payload: opts.payload, operationKey: randomUUID() } : {}),
  }).where(and(eq(workflowJobs.id, id), inArray(workflowJobs.status, ['failed', 'dead', 'canceled']))).returning();
  if (row) scheduleJobPickup(row.id, row.runAt);
  return row ?? null;
}

export async function skipJob(id: number): Promise<WorkflowJobRow | null> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(workflowJobs).where(eq(workflowJobs.id, id)).for('update');
    if (!job || !['pending', 'running', 'paused', 'failed', 'dead'].includes(job.status)) return null;
    const [row] = await tx.update(workflowJobs).set({ status: 'canceled', generation: sql`${workflowJobs.generation} + 1`, pausedRemainingMs: null, ...clearedLease })
      .where(eq(workflowJobs.id, id)).returning();
    await closeExecution(tx, job.leaseToken, 'failed', { errorMessage: 'Job canceled by operator' });
    return row;
  });
}


interface ClaimedJob { job: WorkflowJobRow; executionId: number }

async function claimJob(jobId: number): Promise<ClaimedJob | null> {
  return db.transaction(async (tx) => {
    const token = randomUUID();
    const [job] = await tx.update(workflowJobs).set({
      status: 'running', lockedAt: dbNow, lockedBy: WORKER_ID, leaseToken: token,
      leaseUntil: sql`clock_timestamp() + ${WORKFLOW_JOB_LEASE_MS} * interval '1 millisecond'`,
      executionDeadline: sql`clock_timestamp() + ${workflowJobs.executionTimeoutMs} * interval '1 millisecond'`,
      attempts: sql`${workflowJobs.attempts} + 1`,
    }).where(and(eq(workflowJobs.id, jobId), eq(workflowJobs.status, 'pending'), lte(workflowJobs.runAt, dbNow),
      sql`${workflowJobs.attempts} < ${workflowJobs.maxAttempts}`)).returning();
    if (!job) return null;
    const [execution] = await tx.insert(workflowJobExecutions).values({
      jobId: job.id, jobType: job.jobType, attempt: job.attempts, generation: job.generation,
      leaseToken: token, status: 'running', startedAt: job.lockedAt, tenantId: job.tenantId,
    }).returning({ id: workflowJobExecutions.id });
    return { job, executionId: execution.id };
  });
}

async function finishJob(context: WorkflowJobContext, error: unknown, result: WorkflowJobResult = {}): Promise<void> {
  const succeeded = !error || error instanceof WorkflowJobSkip;
  const permanent = error instanceof WorkflowJobPermanentError || (error instanceof WorkflowJobError && error.permanent);
  const row = await db.transaction(async (tx) => {
    const originalMessage = error instanceof Error ? error.message : error ? String(error) : null;
    const sourceDetail = error instanceof WorkflowJobError ? error.detail ?? {} : result;
    const uncertain = !succeeded && await hasUncertainExternalEffect(tx, context.leaseToken, sourceDetail.responseStatus);
    const retry = !succeeded && !permanent && !uncertain && context.attempt < context.job.maxAttempts;
    const message = uncertain ? `外部操作结果待确认：${originalMessage ?? '执行中断'}` : originalMessage;
    const detail = { ...sourceDetail, errorMessage: message };
    const [updated] = await tx.update(workflowJobs).set({
      status: succeeded ? 'succeeded' : retry ? 'pending' : 'dead', ...clearedLease,
      lastError: message?.slice(0, 2048) ?? null, result: succeeded ? result.result ?? null : null,
      ...(retry ? { runAt: sql`clock_timestamp() + ${computeBackoffMs(context.attempt)} * interval '1 millisecond'` } : {}),
    }).where(ownedJobCondition(context, !(error instanceof WorkflowJobDeadlineError))).returning();
    if (!updated) return null;
    await closeExecution(tx, context.leaseToken, succeeded ? 'succeeded' : 'failed', detail);
    return updated;
  });
  if (row?.status === 'pending') scheduleJobPickup(row.id, row.runAt);
}

async function executeClaimedJob({ job, executionId }: ClaimedJob): Promise<void> {
  const controller = new AbortController();
  const context: WorkflowJobContext = {
    job, executionId, attempt: job.attempts, payload: (job.payload ?? {}) as Record<string, unknown>,
    generation: job.generation, leaseToken: job.leaseToken!, executionDeadline: job.executionDeadline!,
    operationKey: job.operationKey, signal: controller.signal,
  };
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy || controller.signal.aborted) return;
    heartbeatBusy = true;
    void db.update(workflowJobs).set({
      leaseUntil: sql`least(clock_timestamp() + ${WORKFLOW_JOB_LEASE_MS} * interval '1 millisecond', ${workflowJobs.executionDeadline})`,
    }).where(ownedJobCondition(context)).returning({ id: workflowJobs.id }).then((rows) => {
      if (!rows.length) controller.abort(Date.now() >= context.executionDeadline.getTime()
        ? new WorkflowJobDeadlineError() : new WorkflowJobLeaseLostError());
    }).catch(() => controller.abort(new WorkflowJobLeaseLostError('Workflow job heartbeat failed')))
      .finally(() => { heartbeatBusy = false; });
  }, WORKFLOW_JOB_HEARTBEAT_MS);
  heartbeat.unref?.();
  const deadline = setTimeout(
    () => controller.abort(new WorkflowJobDeadlineError()),
    Math.max(0, job.executionDeadline!.getTime() - Date.now()),
  );
  deadline.unref?.();
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  void aborted.catch(() => undefined);
  try {
    const handler = getJobHandler(job.jobType);
    if (!handler) throw new WorkflowJobPermanentError(`Unregistered workflow handler: ${job.jobType}`);
    const work = runWithWorkflowJobContext(context, () => runWithTraceId(job.traceId ?? randomUUID(),
      () => runWithParentRef(`job:${job.id}`, () => handler(context))));
    const result = (await Promise.race([work, aborted])) ?? {};
    await flushWorkflowJobEffects(context);
    await finishJob(context, null, result);
  } catch (error) {
    let failure = error;
    try {
      await flushWorkflowJobEffects(context);
    } catch (effectError) {
      failure = effectError;
    }
    if (!(failure instanceof WorkflowJobLeaseLostError)) await finishJob(context, failure);
  } finally {
    clearInterval(heartbeat);
    clearTimeout(deadline);
    if (!controller.signal.aborted) controller.abort(new WorkflowJobLeaseLostError('Workflow job attempt finished'));
  }
}

/** This worker entry is the only production path that executes handlers. */
export async function runJob(jobId: number): Promise<void> {
  const claimed = await claimJob(jobId);
  if (claimed) await executeClaimedJob(claimed);
}

export interface DrainableFilter { jobTypes?: WorkflowJobType[]; instanceId?: number; olderThanMinutes?: number }
export interface DrainWorkflowJobsOptions extends DrainableFilter { batch?: number; limit?: number }

function extraConditions(filter: DrainableFilter): SQL[] {
  const conds: SQL[] = [];
  if (filter.jobTypes?.length) conds.push(inArray(workflowJobs.jobType, filter.jobTypes));
  if (filter.instanceId != null) conds.push(eq(workflowJobs.instanceId, filter.instanceId));
  if (filter.olderThanMinutes != null && filter.olderThanMinutes > 0) {
    conds.push(lte(workflowJobs.createdAt, sql`clock_timestamp() - ${filter.olderThanMinutes} * interval '1 minute'`));
  }
  return conds;
}

export function expiredWorkflowJobCondition() {
  return and(eq(workflowJobs.status, 'running'), or(isNull(workflowJobs.leaseUntil),
    lte(workflowJobs.leaseUntil, dbNow), lte(workflowJobs.executionDeadline, dbNow)));
}

async function recoverExpiredJobs(tx: DbTransaction, filter: DrainableFilter, limit: number): Promise<{
  recovered: number;
  dead: number;
  wakeups: Array<{ id: number; runAt: Date }>;
}> {
  const expired = await tx.select().from(workflowJobs).where(and(expiredWorkflowJobCondition(), ...extraConditions(filter)))
    .orderBy(asc(workflowJobs.id)).limit(limit).for('update', { skipLocked: true });
  let dead = 0;
  let recovered = 0;
  const wakeups: Array<{ id: number; runAt: Date }> = [];
  for (const job of expired) {
    const uncertain = await hasUncertainExternalEffect(tx, job.leaseToken);
    const exhausted = uncertain || job.attempts >= job.maxAttempts;
    const message = uncertain ? '外部操作结果待确认：执行租约或执行时限已过期' : 'Workflow job lease or execution deadline expired';
    const [updated] = await tx.update(workflowJobs).set({
      status: exhausted ? 'dead' : 'pending', pausedRemainingMs: null,
      ...clearedLease, runAt: dbNow, lastError: message,
    }).where(and(eq(workflowJobs.id, job.id), eq(workflowJobs.generation, job.generation), expiredWorkflowJobCondition()))
      .returning({ id: workflowJobs.id, status: workflowJobs.status, runAt: workflowJobs.runAt });
    if (!updated) continue;
    recovered++;
    await closeExecution(tx, job.leaseToken, 'failed', { errorMessage: message });
    if (updated.status === 'dead') dead++;
    else wakeups.push({ id: updated.id, runAt: updated.runAt });
  }
  return { recovered, dead, wakeups };
}

/** Reconcile expired leases and publish wakeups without executing handlers. */
export async function drainWorkflowJobs(opts: DrainWorkflowJobsOptions = {}): Promise<{ recovered: number; requeued: number; dead: number }> {
  const limit = Math.max(1, Math.min(opts.limit ?? opts.batch ?? 200, 1000));
  const recovery = await db.transaction((tx) => recoverExpiredJobs(tx, opts, limit));
  const remaining = Math.max(0, limit - recovery.recovered);
  const recoveredIds = recovery.wakeups.map((job) => job.id);
  const pending = remaining === 0 ? [] : await db.select({ id: workflowJobs.id, runAt: workflowJobs.runAt }).from(workflowJobs)
    .where(and(
      eq(workflowJobs.status, 'pending'), lte(workflowJobs.runAt, dbNow),
      recoveredIds.length ? notInArray(workflowJobs.id, recoveredIds) : undefined,
      ...extraConditions(opts),
    )).orderBy(asc(workflowJobs.priority), asc(workflowJobs.runAt)).limit(remaining);
  let requeued = 0;
  for (const job of [...recovery.wakeups, ...pending]) {
    if (await publishWorkflowJobPickup(job.id, job.runAt)) requeued++;
  }
  return { recovered: recovery.recovered, dead: recovery.dead, requeued };
}

export async function previewDrainableJobs(filter: DrainableFilter & { sampleLimit?: number }) {
  const extra = extraConditions(filter);
  const due = and(eq(workflowJobs.status, 'pending'), lte(workflowJobs.runAt, dbNow), ...extra);
  const later = and(eq(workflowJobs.status, 'pending'), gt(workflowJobs.runAt, dbNow), ...extra);
  const expired = and(expiredWorkflowJobCondition(), ...extra);
  const [duePending, stuckRunning, scheduledLater, rows] = await Promise.all([
    db.$count(workflowJobs, due), db.$count(workflowJobs, expired), db.$count(workflowJobs, later),
    db.select({ id: workflowJobs.id, jobType: workflowJobs.jobType, status: workflowJobs.status,
      instanceId: workflowJobs.instanceId, traceId: workflowJobs.traceId, attempts: workflowJobs.attempts,
      runAt: workflowJobs.runAt, createdAt: workflowJobs.createdAt, lastError: workflowJobs.lastError,
    }).from(workflowJobs).where(or(due, expired)).orderBy(asc(workflowJobs.runAt)).limit(filter.sampleLimit ?? 10),
  ]);
  return { duePending, stuckRunning, scheduledLater, sample: rows.map((row) => ({
    ...row, runAt: formatDateTime(row.runAt), createdAt: formatDateTime(row.createdAt),
  })) };
}

export async function registerWorkflowJobWorker(): Promise<void> {
  // Handler registration belongs to worker bootstrap, not service-module loading.
  await import('./handlers');
  await registerSystemQueueWorker<{ jobId: number }>({
    name: WORKFLOW_JOB_QUEUE, title: '工作流作业 Worker', module: '工作流',
    description: '消费工作流唤醒消息，取得业务租约后执行作业。',
    handler: async ({ jobId }) => { await runJob(jobId); return `作业 ${jobId} 唤醒已处理`; },
    queueOptions: { retentionSeconds: 604800, retryLimit: 0 },
  });
}
