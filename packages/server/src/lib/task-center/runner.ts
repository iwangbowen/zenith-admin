import { and, eq, gt, inArray, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  ASYNC_TASK_ACTIVE_STATUSES as UNFINISHED_STATUSES,
  ASYNC_TASK_TERMINAL_STATUSES as TERMINAL_STATUSES,
} from '@zenith/shared/tasks';
import { requireRow } from '../db-assert';
import { db } from '../../db';
import { asyncTaskItems, asyncTasks, asyncTaskTypeConfigs, users } from '../../db/schema';
import type { AsyncTaskRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { registerLocalNodeQueueWorker, registerSystemQueueWorker, isSchedulerNodeAlive, nodeQueueName, sendSystemJob, sendSystemJobAfter } from '../pg-boss-scheduler';
import { PROCESS_ID } from '../process-identity';
import { currentUser, runWithCurrentUser, currentTraceId, runWithTraceId, currentParentRef, runWithParentRef } from '../context';
import { exactTenantCondition, getCreateTenantId } from '../tenant';
import { nullableEq } from '../where-helpers';
import type { JwtPayload } from '../../middleware/auth';
import logger from '../logger';
import {
  ASYNC_TASK_QUEUE,
  ASYNC_TASK_RETENTION_DAYS,
  HEARTBEAT_STALE_MS,
  PENDING_REDISPATCH_MS,
  RETRY_BACKOFF_MAX_MS,
  TaskCancelledError,
  type TaskItemReport,
  type TaskProgressResult,
  type TaskProgressUpdate,
  type TaskRunContext,
} from './types';
import { getTaskHandler } from './registry';
import { ensureTaskTypeConfig, getTaskTypePolicy } from './config';
import { pushTaskProgress } from './map';

export interface SubmitAsyncTaskInput {
  taskType: string;
  /** 任务标题；缺省用注册表中的默认标题 */
  title?: string;
  payload?: Record<string, unknown>;
  /** 幂等键：相同 key 重复提交时直接返回已存在的任务（不新建） */
  idempotencyKey?: string | null;
}

/** 完整提交：业务记录提交后才投递，投递失败由 pending 扫描补投。 */
export async function submitAsyncTask(input: SubmitAsyncTaskInput): Promise<AsyncTaskRow> {
  const row = await db.transaction((tx) => persistAsyncTask(tx, input));
  await enqueueCommittedTask(row);
  return row;
}

/** 事务内入口：全部读取和写入共用 tx，调用方提交后再投递。 */
export async function persistAsyncTask(
  executor: DbTransaction,
  input: SubmitAsyncTaskInput,
): Promise<AsyncTaskRow> {
  const handler = getTaskHandler(input.taskType);
  if (!handler) throw new HTTPException(400, { message: `任务类型 "${input.taskType}" 未注册` });
  const user = currentUser();
  const tenantId = getCreateTenantId(user);
  const idempotencyKey = input.idempotencyKey?.slice(0, 128) || null;
  await lockTaskAdmission(executor, input.taskType, user.userId, tenantId);
  const scope = and(
    eq(asyncTasks.taskType, input.taskType),
    eq(asyncTasks.createdBy, user.userId),
    exactTenantCondition(asyncTasks.tenantId, tenantId),
  );
  if (idempotencyKey) {
    const [existing] = await executor.select().from(asyncTasks)
      .where(and(scope, eq(asyncTasks.idempotencyKey, idempotencyKey))).limit(1);
    if (existing) return existing;
  }
  const policy = await getTaskTypePolicy(executor, input.taskType);
  if (!policy.enabled) {
    throw new HTTPException(400, { message: `「${handler.title}」已暂停提交，请联系管理员` });
  }
  if (!policy.allowConcurrent) {
    const unfinished = await executor.$count(asyncTasks, and(
      scope,
      inArray(asyncTasks.status, UNFINISHED_STATUSES),
    ));
    if (unfinished > 0) {
      throw new HTTPException(400, { message: `已有进行中的「${handler.title}」任务，请等待其结束后再提交` });
    }
  }
  const values = {
    taskType: input.taskType,
    title: input.title?.slice(0, 128) || handler.title,
    payload: input.payload ?? {},
    maxAttempts: policy.maxAttempts,
    retryDelayMs: policy.retryDelayMs,
    idempotencyKey,
    tenantId,
    // 链路关联：任务与其提交请求同链，worker 执行时恢复该 trace 作用域
    traceId: currentTraceId() ?? null,
    parentRef: currentParentRef() ?? null,
    // 显式写入而非依赖 db Proxy 的审计注入：createdBy 是幂等作用域的一部分，
    // 下面的冲突回查要按它过滤，作用域不能取决于别处的副作用。
    createdBy: user.userId,
    // 节点亲和任务只能由本进程执行（操作本机资源），投递到本进程独有的队列
    nodeId: handler.affinity === 'node' ? PROCESS_ID : null,
  };
  let row: AsyncTaskRow | undefined;
  if (idempotencyKey) {
    // 唯一性由 async_tasks_idem_{tenant,platform}_uq 两个部分索引保证（按租户是否为空二选一），
    // 故这里用不带 target 的 onConflictDoNothing，命中哪个索引都能兜住。
    [row] = await executor.insert(asyncTasks).values(values)
      .onConflictDoNothing().returning();
    if (!row) {
      // 幂等命中：必须按完整作用域回查。只按 key 查会把别的租户/用户/任务类型的行
      // 连同 payload、result 一起返回给调用方。
      const [existing] = await executor.select().from(asyncTasks)
        .where(and(
          eq(asyncTasks.idempotencyKey, idempotencyKey),
          eq(asyncTasks.taskType, input.taskType),
          eq(asyncTasks.createdBy, user.userId),
          exactTenantCondition(asyncTasks.tenantId, tenantId),
        ))
        .limit(1);
      if (existing) return existing;
      throw new HTTPException(500, { message: '任务提交异常，请重试' });
    }
  } else {
    [row] = await executor.insert(asyncTasks).values(values).returning();
  }
  return row;
}

/** 同一提交作用域串行准入，保护 allowConcurrent 的 count + insert。 */
async function lockTaskAdmission(executor: DbTransaction, taskType: string, userId: number | null, tenantId: number | null): Promise<void> {
  const key = JSON.stringify(['async-task-admission', tenantId, userId, taskType]);
  await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

async function enqueueCommittedTask(row: AsyncTaskRow): Promise<void> {
  if (row.status !== 'pending') return;
  await enqueueTaskRow(row).catch((err) => {
    logger.error('[task-center] 已持久化任务投递失败，等待 pending 扫描补投', { taskId: row.id, err });
  });
  pushTaskProgress(row, { force: true });
}

/** 任务所属队列：节点亲和任务走目标进程独有的节点队列，其余走共享队列 */
function queueForTask(task: Pick<AsyncTaskRow, 'nodeId'>): string {
  return task.nodeId ? nodeQueueName(ASYNC_TASK_QUEUE, task.nodeId) : ASYNC_TASK_QUEUE;
}

async function enqueueTaskRow(task: Pick<AsyncTaskRow, 'id' | 'nodeId'>): Promise<void> {
  // singletonKey 防止同一任务在队列中堆积多条待消费消息；worker 侧原子领取兜底
  await sendSystemJob(queueForTask(task), { taskId: task.id }, {
    retryLimit: 0,
    singletonKey: `async-task-${task.id}`,
    retentionSeconds: 60 * 60 * 24,
  });
}

export async function enqueueAsyncTask(taskId: number): Promise<void> {
  const [row] = await db.select({ id: asyncTasks.id, nodeId: asyncTasks.nodeId }).from(asyncTasks)
    .where(eq(asyncTasks.id, taskId)).limit(1);
  if (!row) return;
  await enqueueTaskRow(row);
}

/** 从任务行还原创建者身份（handler 内可用 currentUser()、审计上下文） */
async function getCreatorPayload(row: AsyncTaskRow): Promise<JwtPayload | null> {
  if (!row.createdBy) return null;
  const user = await db.query.users.findFirst({
    where: eq(users.id, row.createdBy),
    columns: { id: true, username: true, tenantId: true },
    with: { userRoles: { columns: {}, with: { role: { columns: { code: true } } } } },
  });
  if (!user) return null;
  return {
    userId: user.id,
    username: user.username,
    roles: user.userRoles.map((item) => item.role.code),
    tenantId: user.tenantId,
  };
}

async function applyProgress(taskId: number, update: TaskProgressUpdate): Promise<TaskProgressResult> {
  const set: Partial<typeof asyncTasks.$inferInsert> = { heartbeatAt: new Date() };
  if (update.processed !== undefined) set.processedCount = Math.max(0, Math.trunc(update.processed));
  if (update.failed !== undefined) set.failedCount = Math.max(0, Math.trunc(update.failed));
  if (update.total !== undefined) set.totalCount = update.total === null ? null : Math.max(0, Math.trunc(update.total));
  if (update.note !== undefined) set.progressNote = update.note?.slice(0, 256) ?? null;
  if (update.checkpoint !== undefined) set.checkpoint = update.checkpoint;
  const [row] = await db.update(asyncTasks).set(set)
    .where(and(eq(asyncTasks.id, taskId), eq(asyncTasks.status, 'running')))
    .returning();
  // 行已不是 running（被取消/被兜底回收）→ 通知 handler 尽快退出
  if (!row) return { cancelRequested: true };
  pushTaskProgress(row);
  return { cancelRequested: row.cancelRequested };
}

/** 批量 upsert 任务项明细（按 taskId+itemKey 幂等，重试覆盖旧状态） */
async function applyItemReports(taskId: number, attempt: number, items: TaskItemReport[]): Promise<void> {
  if (items.length === 0) return;
  const values = items.map((item) => ({
    taskId,
    itemKey: item.key.slice(0, 128),
    label: item.label?.slice(0, 256) ?? null,
    status: item.status,
    message: item.message?.slice(0, 2000) ?? null,
    data: item.data ?? null,
    attempt,
  }));
  await db.insert(asyncTaskItems).values(values)
    .onConflictDoUpdate({
      target: [asyncTaskItems.taskId, asyncTaskItems.itemKey],
      set: {
        label: sql`excluded.label`,
        status: sql`excluded.status`,
        message: sql`excluded.message`,
        data: sql`excluded.data`,
        attempt: sql`excluded.attempt`,
        updatedAt: new Date(),
      },
    });
}

/** 计算第 attempts 次失败后的重试延迟：base * 2^(attempts-1)，上限 15 分钟 */
function retryDelayFor(attempts: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** Math.max(attempts - 1, 0), RETRY_BACKOFF_MAX_MS);
}

/** 执行一个任务（由队列 Worker 调用）；返回写入调度中心运行日志的消息 */
export async function runAsyncTask(taskId: number): Promise<string> {
  // 原子领取：仅 pending 且到达 nextRunAt（重试退避）可被领取，重复投递/并发消费天然无害
  const now = new Date();
  const [claimed] = await db.update(asyncTasks)
    .set({
      status: 'running',
      attempts: sql`${asyncTasks.attempts} + 1`,
      startedAt: sql`coalesce(${asyncTasks.startedAt}, now())`,
      heartbeatAt: now,
      nextRunAt: null,
      errorMessage: null,
    })
    .where(and(
      eq(asyncTasks.id, taskId),
      eq(asyncTasks.status, 'pending'),
      or(isNull(asyncTasks.nextRunAt), lte(asyncTasks.nextRunAt, now)),
    ))
    .returning();
  if (!claimed) return `任务 #${taskId} 无需执行（已被领取、已结束或未到重试时间）`;
  pushTaskProgress(claimed, { force: true });

  const handler = getTaskHandler(claimed.taskType);
  if (!handler) {
    const [failedRow] = await db.update(asyncTasks)
      .set({ status: 'failed', errorMessage: `任务类型 "${claimed.taskType}" 未注册`, completedAt: new Date() })
      .where(and(eq(asyncTasks.id, taskId), eq(asyncTasks.status, 'running')))
      .returning();
    if (failedRow) pushTaskProgress(failedRow, { force: true });
    return `任务 #${taskId} 失败：任务类型 "${claimed.taskType}" 未注册`;
  }

  const ctx: TaskRunContext = {
    taskId: claimed.id,
    payload: claimed.payload ?? {},
    checkpoint: claimed.checkpoint ?? null,
    attempt: claimed.attempts, // 领取时已 +1，returning 返回的是自增后的值
    progress: (update) => applyProgress(claimed.id, update),
    reportItems: (items) => applyItemReports(claimed.id, claimed.attempts, items),
    isCancelRequested: async () => {
      const [row] = await db.select({ cancelRequested: asyncTasks.cancelRequested, status: asyncTasks.status })
        .from(asyncTasks).where(eq(asyncTasks.id, claimed.id)).limit(1);
      return !row || row.status !== 'running' || row.cancelRequested;
    },
  };

  try {
    const creator = await getCreatorPayload(claimed);
    // 恢复提交时的链路作用域并登记因果父节点：handler 内的日志/作业/事件/通知继续同链且挂到本任务下
    const runHandler = () => runWithParentRef(`task:${claimed.id}`, () => (creator
      ? runWithCurrentUser(creator, () => handler.run(ctx))
      : handler.run(ctx)));
    const result = claimed.traceId
      ? await runWithTraceId(claimed.traceId, runHandler)
      : await runHandler();

    const [current] = await db.select().from(asyncTasks).where(eq(asyncTasks.id, taskId)).limit(1);
    if (!current || current.status !== 'running') {
      return `任务 #${taskId} 已被其他流程接管（当前状态：${current?.status ?? '不存在'}）`;
    }
    const finalStatus = current.cancelRequested ? 'cancelled' : 'success';
    const [finalRow] = await db.update(asyncTasks)
      .set({
        status: finalStatus,
        ...(result && typeof result === 'object' ? { result } : {}),
        completedAt: new Date(),
      })
      .where(and(eq(asyncTasks.id, taskId), eq(asyncTasks.status, 'running')))
      .returning();
    if (finalRow) pushTaskProgress(finalRow, { force: true });
    return finalStatus === 'cancelled' ? `任务 #${taskId}「${claimed.title}」已取消` : `任务 #${taskId}「${claimed.title}」执行成功`;
  } catch (err) {
    const message = (err instanceof Error ? err.message : '任务执行失败').slice(0, 2000);
    if (err instanceof TaskCancelledError) {
      const [cancelledRow] = await db.update(asyncTasks)
        .set({
          status: 'cancelled',
          errorMessage: message,
          ...(err.result ? { result: err.result } : {}),
          completedAt: new Date(),
          heartbeatAt: null,
        })
        .where(and(eq(asyncTasks.id, taskId), eq(asyncTasks.status, 'running')))
        .returning();
      if (cancelledRow) pushTaskProgress(cancelledRow, { force: true });
      return `任务 #${taskId} 已取消：${message}`;
    }

    // 自动重试：未用尽 maxAttempts 且未请求取消 → 回到 pending，按退避延迟重投（保留 checkpoint 断点续跑）
    const [currentRow] = await db.select({ cancelRequested: asyncTasks.cancelRequested })
      .from(asyncTasks).where(eq(asyncTasks.id, taskId)).limit(1);
    const canRetry = claimed.attempts < claimed.maxAttempts && !(currentRow?.cancelRequested ?? false);
    if (canRetry) {
      const delayMs = retryDelayFor(claimed.attempts, claimed.retryDelayMs);
      const nextRunAt = new Date(Date.now() + delayMs);
      const [retryRow] = await db.update(asyncTasks)
        .set({
          status: 'pending',
          errorMessage: message,
          progressNote: `执行失败，${Math.round(delayMs / 1000)} 秒后自动重试（第 ${claimed.attempts + 1}/${claimed.maxAttempts} 次）`,
          nextRunAt,
          heartbeatAt: null,
        })
        .where(and(eq(asyncTasks.id, taskId), eq(asyncTasks.status, 'running')))
        .returning();
      if (retryRow) {
        pushTaskProgress(retryRow, { force: true });
        await sendSystemJobAfter(queueForTask(claimed), { taskId }, nextRunAt, {
          retryLimit: 0,
          singletonKey: `async-task-retry-${taskId}-${claimed.attempts}`,
          retentionSeconds: 60 * 60 * 24,
        });
        logger.warn(`[task-center] 任务 #${taskId} 第 ${claimed.attempts} 次执行失败，${Math.round(delayMs / 1000)}s 后自动重试：${message}`);
        return `任务 #${taskId} 执行失败，已安排第 ${claimed.attempts + 1}/${claimed.maxAttempts} 次自动重试`;
      }
    }

    const [failedRow] = await db.update(asyncTasks)
      .set({ status: 'failed', errorMessage: message, completedAt: new Date() })
      .where(and(eq(asyncTasks.id, taskId), eq(asyncTasks.status, 'running')))
      .returning();
    if (failedRow) pushTaskProgress(failedRow, { force: true });
    throw err; // 让调度中心运行日志记为 failed（触发告警策略）
  }
}

/** 取消任务：pending 直接终止；running 置协作式取消标记，由 handler 在处理间隙退出 */
export async function requestCancelAsyncTask(taskId: number): Promise<AsyncTaskRow> {
  const [pendingRow] = await db.update(asyncTasks)
    .set({ status: 'cancelled', cancelRequested: true, completedAt: new Date() })
    .where(and(eq(asyncTasks.id, taskId), eq(asyncTasks.status, 'pending')))
    .returning();
  if (pendingRow) {
    pushTaskProgress(pendingRow, { force: true });
    return pendingRow;
  }
  const [runningRow] = await db.update(asyncTasks)
    .set({ cancelRequested: true })
    .where(and(eq(asyncTasks.id, taskId), eq(asyncTasks.status, 'running')))
    .returning();
  if (runningRow) {
    pushTaskProgress(runningRow, { force: true });
    return runningRow;
  }
  throw new HTTPException(400, { message: '仅待执行或执行中的任务可以取消' });
}

/** 断点恢复：保留进度与 checkpoint，从中断处继续（failed / cancelled 可用） */
export async function resumeAsyncTask(taskId: number): Promise<AsyncTaskRow> {
  const [maybeRow] = await db.update(asyncTasks)
    .set({ status: 'pending', cancelRequested: false, errorMessage: null, completedAt: null, heartbeatAt: null, nextRunAt: null })
    .where(and(eq(asyncTasks.id, taskId), inArray(asyncTasks.status, ['failed', 'cancelled'])))
    .returning();
  const row = requireRow(maybeRow, '仅失败或已取消的任务可以断点恢复', 400);
  await enqueueCommittedTask(row);
  return row;
}

/** 重新开始：清空进度 / 断点 / 结果 / 明细，从头执行（任意已结束状态可用） */
export async function restartAsyncTask(taskId: number): Promise<AsyncTaskRow> {
  const row = await db.transaction((tx) => restartAsyncTaskInTransaction(tx, taskId));
  await enqueueCommittedTask(row);
  return row;
}

export async function restartAsyncTaskInTransaction(executor: DbTransaction, taskId: number): Promise<AsyncTaskRow> {
  const [maybeExisting] = await executor.select({ taskType: asyncTasks.taskType, createdBy: asyncTasks.createdBy, tenantId: asyncTasks.tenantId }).from(asyncTasks)
    .where(eq(asyncTasks.id, taskId)).limit(1);
  const existing = requireRow(maybeExisting, '任务不存在');
  await lockTaskAdmission(executor, existing.taskType, existing.createdBy, existing.tenantId);
  const policy = await getTaskTypePolicy(executor, existing.taskType);
  if (!policy.enabled) throw new HTTPException(400, { message: '该任务类型已暂停提交' });
  if (!policy.allowConcurrent) {
    const unfinished = await executor.$count(asyncTasks, and(
      eq(asyncTasks.taskType, existing.taskType),
      nullableEq(asyncTasks.createdBy, existing.createdBy),
      exactTenantCondition(asyncTasks.tenantId, existing.tenantId),
      inArray(asyncTasks.status, UNFINISHED_STATUSES),
    ));
    if (unfinished > 0) throw new HTTPException(400, { message: '已有进行中的同类型任务，请等待其结束后再提交' });
  }
  const [maybeRow] = await executor.update(asyncTasks)
    .set({
      status: 'pending',
      processedCount: 0,
      failedCount: 0,
      progressNote: null,
      checkpoint: null,
      result: null,
      errorMessage: null,
      cancelRequested: false,
      attempts: 0,
      maxAttempts: policy.maxAttempts, // 重新开始时按当前策略重新快照
      retryDelayMs: policy.retryDelayMs,
      startedAt: null,
      completedAt: null,
      heartbeatAt: null,
      nextRunAt: null,
    })
    .where(and(eq(asyncTasks.id, taskId), inArray(asyncTasks.status, TERMINAL_STATUSES)))
    .returning();
  const row = requireRow(maybeRow, '仅已结束的任务可以重新开始', 400);
  await executor.delete(asyncTaskItems).where(eq(asyncTaskItems.taskId, taskId));
  return row;
}

/**
 * 兜底扫描（每分钟）：
 * 1. 回收卡死的 running 任务（心跳超时，进程崩溃/重启导致）→ 从断点重投续跑；
 * 2. 重投长时间未被领取的 pending 任务（如队列消息丢失）。
 */
export async function drainAsyncTasks(): Promise<{ recovered: number; redispatched: number }> {
  const staleCutoff = new Date(Date.now() - HEARTBEAT_STALE_MS);
  const staleRunning = and(
    eq(asyncTasks.status, 'running'),
    or(lt(asyncTasks.heartbeatAt, staleCutoff), and(isNull(asyncTasks.heartbeatAt), lt(asyncTasks.updatedAt, staleCutoff))),
  );

  // 卡死且已请求取消 → 直接终止
  const cancelledRows = await db.update(asyncTasks)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(and(staleRunning, eq(asyncTasks.cancelRequested, true)))
    .returning();
  for (const row of cancelledRows) pushTaskProgress(row, { force: true });

  // 卡死未取消 → 回收为 pending 从断点续跑
  const recoveredRows = await db.update(asyncTasks)
    .set({ status: 'pending', heartbeatAt: null })
    .where(and(staleRunning, eq(asyncTasks.cancelRequested, false)))
    .returning({ id: asyncTasks.id, nodeId: asyncTasks.nodeId });
  let orphaned = 0;
  for (const row of recoveredRows) {
    if (await failIfNodeGone(row)) { orphaned += 1; continue; }
    logger.warn(`[task-center] 回收卡死任务 #${row.id}，已重投从断点续跑`);
    await enqueueTaskRow(row);
  }

  // 长时间停留 pending 且已到执行时间 → 兜底重投（原子领取保证重复投递无害；退避中的重试任务不提前投）
  const pendingCutoff = new Date(Date.now() - PENDING_REDISPATCH_MS);
  const stalePending = await db.select({ id: asyncTasks.id, nodeId: asyncTasks.nodeId }).from(asyncTasks)
    .where(and(
      eq(asyncTasks.status, 'pending'),
      lt(asyncTasks.updatedAt, pendingCutoff),
      or(isNull(asyncTasks.nextRunAt), lte(asyncTasks.nextRunAt, new Date())),
    ));
  for (const row of stalePending) {
    if (await failIfNodeGone(row)) { orphaned += 1; continue; }
    await enqueueTaskRow(row);
  }

  return { recovered: cancelledRows.length + recoveredRows.length, redispatched: stalePending.length - orphaned };
}

/**
 * 节点亲和任务的目标进程已下线（无活跃心跳）时没有任何进程能执行它：标记失败并告知用户重新提交，
 * 而不是让它永远停在 pending 被反复重投。返回 true 表示已按孤儿处理。
 */
async function failIfNodeGone(task: Pick<AsyncTaskRow, 'id' | 'nodeId'>): Promise<boolean> {
  if (!task.nodeId || await isSchedulerNodeAlive(task.nodeId)) return false;
  const [row] = await db.update(asyncTasks)
    .set({
      status: 'failed',
      errorMessage: `执行节点 ${task.nodeId} 已下线，该任务只能在提交它的服务节点执行，请重新提交`,
      completedAt: new Date(),
    })
    .where(and(eq(asyncTasks.id, task.id), eq(asyncTasks.status, 'pending')))
    .returning();
  if (row) {
    pushTaskProgress(row, { force: true });
    logger.warn(`[task-center] 节点亲和任务 #${task.id} 的目标节点 ${task.nodeId} 已下线，已标记失败`);
  }
  return true;
}

/** 清理超过保留期的已结束任务记录（支持类型级保留期覆盖），返回清理数量 */
export async function cleanupAsyncTasks(retentionDays = ASYNC_TASK_RETENTION_DAYS): Promise<number> {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  // 类型级覆盖：按各自保留期清理；全局保留天数由「数据保留策略」async_tasks 配置驱动
  const overrides = await db.select({ taskType: asyncTaskTypeConfigs.taskType, retentionDays: asyncTaskTypeConfigs.retentionDays })
    .from(asyncTaskTypeConfigs).where(gt(asyncTaskTypeConfigs.retentionDays, 0));
  let cleaned = 0;
  const overriddenTypes: string[] = [];
  for (const override of overrides) {
    if (override.retentionDays == null) continue;
    overriddenTypes.push(override.taskType);
    const cutoff = new Date(now - override.retentionDays * dayMs);
    const rows = await db.delete(asyncTasks)
      .where(and(
        eq(asyncTasks.taskType, override.taskType),
        inArray(asyncTasks.status, TERMINAL_STATUSES),
        lt(asyncTasks.completedAt, cutoff),
      ))
      .returning({ id: asyncTasks.id });
    cleaned += rows.length;
  }
  // 其余类型走全局保留期
  const globalCutoff = new Date(now - retentionDays * dayMs);
  const conditions = [inArray(asyncTasks.status, TERMINAL_STATUSES), lt(asyncTasks.completedAt, globalCutoff)];
  if (overriddenTypes.length > 0) conditions.push(notInArray(asyncTasks.taskType, overriddenTypes));
  const rows = await db.delete(asyncTasks).where(and(...conditions)).returning({ id: asyncTasks.id });
  return cleaned + rows.length;
}

/** 待清理的已结束任务数量（与 cleanupAsyncTasks 同口径，供数据保留策略预览） */
export async function countCleanableAsyncTasks(retentionDays = ASYNC_TASK_RETENTION_DAYS): Promise<number> {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const overrides = await db.select({ taskType: asyncTaskTypeConfigs.taskType, retentionDays: asyncTaskTypeConfigs.retentionDays })
    .from(asyncTaskTypeConfigs).where(gt(asyncTaskTypeConfigs.retentionDays, 0));
  let pending = 0;
  const overriddenTypes: string[] = [];
  for (const override of overrides) {
    if (override.retentionDays == null) continue;
    overriddenTypes.push(override.taskType);
    pending += await db.$count(asyncTasks, and(
      eq(asyncTasks.taskType, override.taskType),
      inArray(asyncTasks.status, TERMINAL_STATUSES),
      lt(asyncTasks.completedAt, new Date(now - override.retentionDays * dayMs)),
    ));
  }
  const conditions = [inArray(asyncTasks.status, TERMINAL_STATUSES), lt(asyncTasks.completedAt, new Date(now - retentionDays * dayMs))];
  if (overriddenTypes.length > 0) conditions.push(notInArray(asyncTasks.taskType, overriddenTypes));
  return pending + await db.$count(asyncTasks, and(...conditions));
}

/**
 * 注册任务中心队列 Worker（启动时调用一次；会出现在系统调度页）。
 * 共享队列的声明在任何角色都做（api 要能投递），领取只在 worker 角色激活（pg-boss-scheduler 内部按角色门控）；
 * 存在节点亲和任务类型时，本进程无论角色都消费自己的节点队列——那是唯一允许 api 执行作业的例外。
 */
export async function registerAsyncTaskWorker(): Promise<void> {
  // 为所有已注册任务类型落库默认策略（已存在则保留用户修改）
  const { listTaskHandlers } = await import('./registry');
  const handlers = listTaskHandlers();
  for (const handler of handlers) {
    await ensureTaskTypeConfig(handler).catch((err) => logger.warn('[task-center] 类型策略初始化失败', { taskType: handler.taskType, err }));
  }
  await registerSystemQueueWorker<{ taskId: number }>({
    name: ASYNC_TASK_QUEUE,
    title: '异步任务执行 Worker',
    module: '任务中心',
    description: '消费任务中心队列，执行业务模块注册的异步任务并维护进度、断点与心跳。',
    handler: ({ taskId }) => runAsyncTask(taskId),
    queueOptions: { retentionSeconds: 60 * 60 * 24 * 7 },
  });
  if (handlers.some((handler) => handler.affinity === 'node')) {
    await registerLocalNodeQueueWorker<{ taskId: number }>(
      ASYNC_TASK_QUEUE,
      async ({ taskId }) => { await runAsyncTask(taskId); },
      { retentionSeconds: 60 * 60 * 24 },
    );
  }
}
