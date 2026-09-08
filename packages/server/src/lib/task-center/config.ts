import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { asyncTaskTypeConfigs } from '../../db/schema';
import { RETRY_BACKOFF_MAX_MS, type TaskHandlerRegistration, type TaskTypeRuntimePolicy } from './types';
import { getTaskHandler, registrationDefaults } from './registry';

function defaultsOf(handler: TaskHandlerRegistration): TaskTypeRuntimePolicy {
  return registrationDefaults(handler);
}

function clampAttempts(value: number): number {
  return Math.min(Math.max(Math.trunc(value), 1), 10);
}

function clampDelay(value: number): number {
  return Math.min(Math.max(Math.trunc(value), 1000), RETRY_BACKOFF_MAX_MS);
}

/** 注册时写入类型默认策略（已存在则不覆盖用户修改） */
export async function ensureTaskTypeConfig(handler: TaskHandlerRegistration): Promise<void> {
  const defaults = defaultsOf(handler);
  await db.insert(asyncTaskTypeConfigs).values({
    taskType: handler.taskType,
    enabled: defaults.enabled,
    allowConcurrent: defaults.allowConcurrent,
    maxAttempts: defaults.maxAttempts,
    retryDelayMs: defaults.retryDelayMs,
    retentionDays: defaults.retentionDays,
  }).onConflictDoNothing({ target: asyncTaskTypeConfigs.taskType });
}

/** 仅缺少覆盖行时使用注册默认值；读取故障交由调用方事务回滚。 */
export async function getTaskTypePolicy(executor: DbExecutor, taskType: string): Promise<TaskTypeRuntimePolicy> {
  const handler = getTaskHandler(taskType);
  if (!handler) throw new HTTPException(400, { message: `任务类型 "${taskType}" 未注册` });
  const [row] = await executor.select().from(asyncTaskTypeConfigs)
    .where(eq(asyncTaskTypeConfigs.taskType, taskType)).limit(1);
  if (!row) return defaultsOf(handler);
  return {
    enabled: row.enabled,
    allowConcurrent: row.allowConcurrent,
    maxAttempts: clampAttempts(row.maxAttempts),
    retryDelayMs: clampDelay(row.retryDelayMs),
    retentionDays: row.retentionDays ?? null,
  };
}

export async function listTaskTypeConfigs(): Promise<Map<string, TaskTypeRuntimePolicy>> {
  const rows = await db.select().from(asyncTaskTypeConfigs);
  return new Map(rows.map((row) => [row.taskType, {
    enabled: row.enabled,
    allowConcurrent: row.allowConcurrent,
    maxAttempts: clampAttempts(row.maxAttempts),
    retryDelayMs: clampDelay(row.retryDelayMs),
    retentionDays: row.retentionDays ?? null,
  }]));
}

export interface UpdateTaskTypePolicyInput {
  enabled: boolean;
  allowConcurrent: boolean;
  maxAttempts: number;
  retryDelayMs: number;
  retentionDays?: number | null;
}

export async function updateTaskTypePolicy(taskType: string, input: UpdateTaskTypePolicyInput): Promise<TaskTypeRuntimePolicy> {
  if (!getTaskHandler(taskType)) throw new HTTPException(404, { message: `任务类型 "${taskType}" 未注册` });
  const values = {
    enabled: input.enabled,
    allowConcurrent: input.allowConcurrent,
    maxAttempts: clampAttempts(input.maxAttempts),
    retryDelayMs: clampDelay(input.retryDelayMs),
    retentionDays: input.retentionDays != null ? Math.min(Math.max(Math.trunc(input.retentionDays), 1), 3650) : null,
  };
  await db.insert(asyncTaskTypeConfigs)
    .values({ taskType, ...values })
    .onConflictDoUpdate({ target: asyncTaskTypeConfigs.taskType, set: values });
  return getTaskTypePolicy(db, taskType);
}
