import { and, eq, gt, inArray, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { asyncTaskItems, asyncTasks, asyncTaskTypeConfigs, users } from '../../db/schema';
import type { AsyncTaskRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { registerSystemQueueWorker, sendSystemJob, sendSystemJobAfter } from '../pg-boss-scheduler';
import { currentUser, runWithCurrentUser } from '../context';
import { getCreateTenantId } from '../tenant';
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

const UNFINISHED_STATUSES = ['pending', 'running'] as const;
const TERMINAL_STATUSES = ['success', 'failed', 'cancelled'] as const;

export interface SubmitAsyncTaskInput {
  taskType: string;
  /** 任务标题；缺省用注册表中的默认标题 */
  title?: string;
  payload?: Record<string, unknown>;
  /** 幂等键：相同 key 重复提交时直接返回已存在的任务（不新建） */
  idempotencyKey?: string | null;
}

export interface SubmitAsyncTaskOptions {
  /**
   * 外部事务执行器。传入时仅在同一事务写入 pending outbox 记录，默认不立即入队；
   * 调用方应在事务提交后调用 enqueueAsyncTask()。若提交后入队失败，pending 恢复扫描会补投。
   */
  executor?: DbExecutor;
  /** 覆盖默认入队行为；外部事务中禁止设为 true。 */
  enqueue?: boolean;
}

/** 提交异步任务：可直接写入并入队，也可作为外部事务中的 pending outbox 原子持久化。 */
export async function submitAsyncTask(
  input: SubmitAsyncTaskInput,
  options: SubmitAsyncTaskOptions = {},
): Promise<AsyncTaskRow> {
  const handler = getTaskHandler(input.taskType);
  if (!handler) throw new HTTPException(400, { message: `任务类型 "${input.taskType}" 未注册` });
  if (options.executor && options.enqueue === true) {
    throw new HTTPException(500, { message: '外部事务内不能直接入队异步任务' });
  }
  const executor = options.executor ?? db;
  const user = currentUser();
  const policy = await getTaskTypePolicy(input.taskType);
  if (!policy.enabled) {
    throw new HTTPException(400, { message: `「${handler.title}」已暂停提交，请联系管理员` });
  }
  if (!policy.allowConcurrent) {
    const unfinished = await executor.$count(asyncTasks, and(
      eq(asyncTasks.taskType, input.taskType),
      eq(asyncTasks.createdBy, user.userId),
      inArray(asyncTasks.status, UNFINISHED_STATUSES),
    ));
    if (unfinished > 0) {
      throw new HTTPException(400, { message: `已有进行中的「${handler.title}」任务，请等待其结束后再提交` });
    }
  }
  const idempotencyKey = input.idempotencyKey?.slice(0, 128) || null;
  const values = {
    taskType: input.taskType,
    title: input.title?.slice(0, 128) || handler.title,
    payload: input.payload ?? {},
    maxAttempts: policy.maxAttempts,
    idempotencyKey,
    tenantId: getCreateTenantId(user),
  };
  let row: AsyncTaskRow | undefined;
  if (idempotencyKey) {
    [row] = await executor.insert(asyncTasks).values(values)
      .onConflictDoNothing({ target: asyncTasks.idempotencyKey }).returning();
    if (!row) {
      // 幂等命中：返回已存在的任务
      const [existing] = await executor.select().from(asyncTasks)
        .where(eq(asyncTasks.idempotencyKey, idempotencyKey)).limit(1);
      if (existing) return existing;
      throw new HTTPException(500, { message: '任务提交异常，请重试' });
    }
  } else {
    [row] = await executor.insert(asyncTasks).values(values).returning();
  }
  const shouldEnqueue = options.enqueue ?? !options.executor;
  if (shouldEnqueue) await enqueueAsyncTask(row.id);
  return row;
}

export async function enqueueAsyncTask(taskId: number): Promise<void> {
  // singletonKey 防止同一任务在队列中堆积多条待消费消息；worker 侧原子领取兜底
  await sendSystemJob(ASYNC_TASK_QUEUE, { taskId }, {
    retryLimit: 0,
    singletonKey: `async-task-${taskId}`,
    retentionSeconds: 60 * 60 * 24,
  });
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
    const result = creator
      ? await runWithCurrentUser(creator, () => handler.run(ctx))
      : await handler.run(ctx);

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
      const policy = await getTaskTypePolicy(claimed.taskType);
      const delayMs = retryDelayFor(claimed.attempts, policy.retryDelayMs);
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
        await sendSystemJobAfter(ASYNC_TASK_QUEUE, { taskId }, nextRunAt, {
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
  const [row] = await db.update(asyncTasks)
    .set({ status: 'pending', cancelRequested: false, errorMessage: null, completedAt: null, heartbeatAt: null, nextRunAt: null })
    .where(and(eq(asyncTasks.id, taskId), inArray(asyncTasks.status, ['failed', 'cancelled'])))
    .returning();
  if (!row) throw new HTTPException(400, { message: '仅失败或已取消的任务可以断点恢复' });
  await enqueueAsyncTask(row.id);
  pushTaskProgress(row, { force: true });
  return row;
}

/** 重新开始：清空进度 / 断点 / 结果 / 明细，从头执行（任意已结束状态可用） */
export async function restartAsyncTask(
  taskId: number,
  options: SubmitAsyncTaskOptions = {},
): Promise<AsyncTaskRow> {
  if (options.executor && options.enqueue === true) {
    throw new HTTPException(500, { message: '外部事务内不能直接入队异步任务' });
  }
  if (!options.executor) {
    const row = await db.transaction((tx) => restartAsyncTask(taskId, { executor: tx }));
    if (options.enqueue !== false) {
      await enqueueAsyncTask(row.id);
      pushTaskProgress(row, { force: true });
    }
    return row;
  }
  const executor = options.executor ?? db;
  const [existing] = await executor.select({ taskType: asyncTasks.taskType }).from(asyncTasks)
    .where(eq(asyncTasks.id, taskId)).limit(1);
  if (!existing) throw new HTTPException(404, { message: '任务不存在' });
  const policy = await getTaskTypePolicy(existing.taskType);
  const [row] = await executor.update(asyncTasks)
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
      startedAt: null,
      completedAt: null,
      heartbeatAt: null,
      nextRunAt: null,
    })
    .where(and(eq(asyncTasks.id, taskId), inArray(asyncTasks.status, TERMINAL_STATUSES)))
    .returning();
  if (!row) throw new HTTPException(400, { message: '仅已结束的任务可以重新开始' });
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
    .returning({ id: asyncTasks.id });
  for (const { id } of recoveredRows) {
    logger.warn(`[task-center] 回收卡死任务 #${id}，已重投从断点续跑`);
    await enqueueAsyncTask(id);
  }

  // 长时间停留 pending 且已到执行时间 → 兜底重投（原子领取保证重复投递无害；退避中的重试任务不提前投）
  const pendingCutoff = new Date(Date.now() - PENDING_REDISPATCH_MS);
  const stalePending = await db.select({ id: asyncTasks.id }).from(asyncTasks)
    .where(and(
      eq(asyncTasks.status, 'pending'),
      lt(asyncTasks.updatedAt, pendingCutoff),
      or(isNull(asyncTasks.nextRunAt), lte(asyncTasks.nextRunAt, new Date())),
    ));
  for (const { id } of stalePending) await enqueueAsyncTask(id);

  return { recovered: cancelledRows.length + recoveredRows.length, redispatched: stalePending.length };
}

/** 清理超过保留期的已结束任务记录（支持类型级保留期覆盖），返回清理数量 */
export async function cleanupAsyncTasks(retentionDays = ASYNC_TASK_RETENTION_DAYS): Promise<number> {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  // 类型级覆盖：按各自保留期清理
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

/** 注册任务中心队列 Worker（启动时调用一次；会出现在系统调度页） */
export async function registerAsyncTaskWorker(): Promise<void> {
  // 为所有已注册任务类型落库默认策略（已存在则保留用户修改）
  const { listTaskHandlers } = await import('./registry');
  for (const handler of listTaskHandlers()) {
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
}
