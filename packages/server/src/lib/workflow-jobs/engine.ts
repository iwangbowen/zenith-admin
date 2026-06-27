import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';
import type { WorkflowJobType } from '@zenith/shared';
import { db } from '../../db';
import { workflowJobs, workflowJobExecutions } from '../../db/schema';
import type { WorkflowJobRow, NewWorkflowJob } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { registerSystemQueueWorker, sendSystemJobAfter } from '../pg-boss-scheduler';
import logger from '../logger';
import {
  WORKFLOW_JOB_QUEUE,
  STUCK_RUNNING_GRACE_MS,
  type WorkflowJobResult,
} from './types';
import { WorkflowJobSkip, WorkflowJobPermanentError, WorkflowJobError } from './errors';
import { computeNextRunAt } from './backoff';
import { getJobHandler } from './registry';

/** 本进程 worker 标识，用于 locked_by 与卡死识别 */
const WORKER_ID = `${process.pid}:${randomUUID().slice(0, 8)}`;

export interface EnqueueJobInput {
  jobType: WorkflowJobType;
  payload?: Record<string, unknown>;
  instanceId?: number | null;
  taskId?: number | null;
  nodeKey?: string | null;
  /** 幂等键：存在同 key 的作业时直接去重返回 null */
  idempotencyKey?: string | null;
  traceId?: string | null;
  priority?: number;
  maxAttempts?: number;
  /** 何时执行（默认立即） */
  runAt?: Date;
  tenantId?: number | null;
}

/**
 * 入队一个作业（幂等）。在事务内调用时传入 executor。
 * 返回新建的作业行；若 idempotencyKey 命中已存在作业则返回 null。
 */
export async function enqueueJob(input: EnqueueJobInput, executor: DbExecutor = db): Promise<WorkflowJobRow | null> {
  const runAt = input.runAt ?? new Date();
  const values: NewWorkflowJob = {
    jobType: input.jobType,
    status: 'pending',
    payload: input.payload ?? {},
    instanceId: input.instanceId ?? null,
    taskId: input.taskId ?? null,
    nodeKey: input.nodeKey ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    traceId: input.traceId ?? null,
    priority: input.priority ?? 100,
    maxAttempts: input.maxAttempts ?? 1,
    runAt,
    tenantId: input.tenantId ?? null,
  };

  let row: WorkflowJobRow | undefined;
  if (input.idempotencyKey) {
    [row] = await executor.insert(workflowJobs).values(values)
      .onConflictDoNothing({ target: workflowJobs.idempotencyKey }).returning();
    if (!row) return null; // 去重命中
  } else {
    [row] = await executor.insert(workflowJobs).values(values).returning();
  }
  if (!row) return null;
  scheduleJobPickup(row.id, runAt);
  return row;
}

/**
 * 取消符合条件的待处理 / 运行中作业（如审批已通过 → 取消该任务的 task_timeout 作业）。
 * 必须至少给一个过滤条件，禁止全量取消。
 */
export async function cancelJobs(
  filter: { taskId?: number; instanceId?: number; jobType?: WorkflowJobType },
  executor: DbExecutor = db,
): Promise<number> {
  const conds = [inArray(workflowJobs.status, ['pending', 'running'] as const)];
  if (filter.taskId != null) conds.push(eq(workflowJobs.taskId, filter.taskId));
  if (filter.instanceId != null) conds.push(eq(workflowJobs.instanceId, filter.instanceId));
  if (filter.jobType != null) conds.push(eq(workflowJobs.jobType, filter.jobType));
  if (conds.length === 1) return 0; // 仅状态条件 → 拒绝全量取消

  const res = await executor.update(workflowJobs)
    .set({ status: 'canceled', lockedAt: null, updatedAt: new Date() })
    .where(and(...conds))
    .returning({ id: workflowJobs.id });
  return res.length;
}

/** 通过 pg-boss 在 runAt 时唤醒统一 Worker 处理该作业（fire-and-forget，drain 为兜底） */
function scheduleJobPickup(jobId: number, runAt: Date): void {
  void sendSystemJobAfter<{ jobId: number }>(WORKFLOW_JOB_QUEUE, { jobId }, runAt, {
    retryLimit: 0, // 重试由作业自身的 attempts/退避控制，pg-boss 不再重复重试
    expireInSeconds: 600,
    retentionSeconds: 60 * 60 * 24,
  }).catch((err) => logger.error('[workflow-jobs] schedule pickup failed', { jobId, err }));
}

/** 乐观领取单个作业：pending → running（attempts 自增）。非 pending 返回 null。 */
async function claimJob(jobId: number): Promise<WorkflowJobRow | null> {
  const [claimed] = await db.update(workflowJobs).set({
    status: 'running',
    lockedAt: new Date(),
    lockedBy: WORKER_ID,
    attempts: sql`${workflowJobs.attempts} + 1`,
    updatedAt: new Date(),
  }).where(and(eq(workflowJobs.id, jobId), eq(workflowJobs.status, 'pending'))).returning();
  return claimed ?? null;
}

/** 批量领取到期的 pending 作业：FOR UPDATE SKIP LOCKED，多 drain 并发安全 */
async function claimDueJobs(limit: number): Promise<WorkflowJobRow[]> {
  return db.transaction(async (tx) => {
    const due = await tx.select({ id: workflowJobs.id }).from(workflowJobs)
      .where(and(eq(workflowJobs.status, 'pending'), lte(workflowJobs.runAt, new Date())))
      .orderBy(asc(workflowJobs.priority), asc(workflowJobs.runAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    if (due.length === 0) return [];
    const ids = due.map((r) => r.id);
    return tx.update(workflowJobs).set({
      status: 'running',
      lockedAt: new Date(),
      lockedBy: WORKER_ID,
      attempts: sql`${workflowJobs.attempts} + 1`,
      updatedAt: new Date(),
    }).where(inArray(workflowJobs.id, ids)).returning();
  });
}

type ExecutionDetail = WorkflowJobResult & { errorMessage?: string | null };

/** 写一条 workflow_job_executions 审计（best-effort，不影响主流程） */
async function recordExecution(
  job: WorkflowJobRow,
  attempt: number,
  status: 'succeeded' | 'failed',
  startedAt: Date,
  detail: ExecutionDetail,
): Promise<void> {
  try {
    const finishedAt = new Date();
    await db.insert(workflowJobExecutions).values({
      jobId: job.id,
      jobType: job.jobType,
      attempt,
      status,
      requestUrl: detail.requestUrl ?? null,
      requestMethod: detail.requestMethod ?? null,
      requestBody: detail.requestBody ?? null,
      responseStatus: detail.responseStatus ?? null,
      responseBody: detail.responseBody ?? null,
      errorMessage: detail.errorMessage ?? null,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      startedAt,
      finishedAt,
      tenantId: job.tenantId ?? null,
    });
  } catch (err) {
    logger.error('[workflow-jobs] record execution failed', { jobId: job.id, err });
  }
}

/** 失败收口：可重试则按退避重排，否则进死信 */
async function failOrDeadLetter(job: WorkflowJobRow, attempt: number, errorMessage: string, permanent: boolean): Promise<void> {
  const canRetry = !permanent && attempt < job.maxAttempts;
  const trimmed = errorMessage.slice(0, 2048);
  if (canRetry) {
    const nextRunAt = computeNextRunAt(attempt);
    await db.update(workflowJobs).set({
      status: 'pending', lockedAt: null, lastError: trimmed, runAt: nextRunAt, updatedAt: new Date(),
    }).where(eq(workflowJobs.id, job.id));
    scheduleJobPickup(job.id, nextRunAt);
  } else {
    await db.update(workflowJobs).set({
      status: 'dead', lockedAt: null, lastError: trimmed, updatedAt: new Date(),
    }).where(eq(workflowJobs.id, job.id));
    logger.warn('[workflow-jobs] job dead-lettered', { jobId: job.id, jobType: job.jobType, attempt, error: trimmed });
  }
}

/** 执行一个已领取（running）的作业：分派 handler、记录审计、收口状态 */
async function executeClaimedJob(job: WorkflowJobRow): Promise<void> {
  const attempt = job.attempts; // 领取时已自增，即本次尝试序号
  const startedAt = new Date();
  const handler = getJobHandler(job.jobType);
  if (!handler) {
    const msg = `未注册的 jobType handler: ${job.jobType}`;
    await failOrDeadLetter(job, attempt, msg, true);
    await recordExecution(job, attempt, 'failed', startedAt, { errorMessage: msg });
    return;
  }

  const payload = (job.payload ?? {}) as Record<string, unknown>;
  try {
    const result = (await handler({ job, attempt, payload })) ?? {};
    await db.update(workflowJobs).set({
      status: 'succeeded', lockedAt: null, lastError: null, result: result.result ?? null, updatedAt: new Date(),
    }).where(eq(workflowJobs.id, job.id));
    await recordExecution(job, attempt, 'succeeded', startedAt, result);
  } catch (err) {
    if (err instanceof WorkflowJobSkip) {
      await db.update(workflowJobs).set({
        status: 'succeeded', lockedAt: null, lastError: err.message, updatedAt: new Date(),
      }).where(eq(workflowJobs.id, job.id));
      await recordExecution(job, attempt, 'succeeded', startedAt, { errorMessage: err.message });
      return;
    }
    let permanent = err instanceof WorkflowJobPermanentError;
    let detail: ExecutionDetail = {};
    if (err instanceof WorkflowJobError) {
      permanent = err.permanent;
      detail = { ...err.detail };
    }
    const msg = err instanceof Error ? err.message : String(err);
    await failOrDeadLetter(job, attempt, msg, permanent);
    await recordExecution(job, attempt, 'failed', startedAt, { ...detail, errorMessage: msg.slice(0, 2048) });
  }
}

/** pg-boss Worker 入口：领取并执行单个作业 */
export async function runJob(jobId: number): Promise<void> {
  const job = await claimJob(jobId);
  if (!job) return; // 已被领取 / 已结束 / 已取消
  await executeClaimedJob(job);
}

/** 回收卡死的 running 作业（领取后超过宽限时间仍未结束，多因进程崩溃）→ 回 pending 重跑 */
async function recoverStuckRunning(): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_RUNNING_GRACE_MS);
  const reset = await db.update(workflowJobs).set({ status: 'pending', lockedAt: null, updatedAt: new Date() })
    .where(and(eq(workflowJobs.status, 'running'), isNotNull(workflowJobs.lockedAt), lt(workflowJobs.lockedAt, cutoff)))
    .returning({ id: workflowJobs.id });
  if (reset.length > 0) logger.warn('[workflow-jobs] recovered stuck running jobs', { count: reset.length });
  return reset.length;
}

/**
 * 兜底扫描 + 崩溃恢复：由周期任务（每分钟）调用。
 * 1) 回收卡死 running；2) 批量领取到期 pending 并执行（SKIP LOCKED 并发安全）。
 */
export async function drainWorkflowJobs(batch = 50): Promise<{ recovered: number; processed: number }> {
  const recovered = await recoverStuckRunning();
  let processed = 0;
  for (let round = 0; round < 20; round++) {
    const claimed = await claimDueJobs(batch);
    if (claimed.length === 0) break;
    for (const job of claimed) {
      await executeClaimedJob(job);
      processed += 1;
    }
    if (claimed.length < batch) break;
  }
  return { recovered, processed };
}

/** 注册统一 Worker（出现在系统调度页，类型为「队列 Worker」） */
export async function registerWorkflowJobWorker(): Promise<void> {
  await registerSystemQueueWorker<{ jobId: number }>({
    name: WORKFLOW_JOB_QUEUE,
    title: '工作流作业 Worker',
    module: '工作流',
    description: '消费统一工作流作业队列：延时唤醒 / 审批超时 / 触发器派发 / 外部审批 / 子流程发起·汇聚 / 事件派发 / Webhook 投递。',
    handler: async ({ jobId }) => {
      await runJob(jobId);
      return `作业 ${jobId} 处理完成`;
    },
    queueOptions: { retentionSeconds: 60 * 60 * 24 * 7 },
  });
}
