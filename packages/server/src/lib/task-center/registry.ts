import type { AsyncTaskTypeMeta } from '@zenith/shared/tasks';
import logger from '../logger';
import { RETRY_BACKOFF_MAX_MS, type TaskHandlerRegistration, type TaskTypeRuntimePolicy } from './types';

const handlers = new Map<string, TaskHandlerRegistration>();
let sealed = false;

export function sealTaskHandlerRegistry(): void { sealed = true; }

/** 注册任务处理器（各业务模块在启动时调用；重复注册以最后一次为准） */
export function registerTaskHandler(registration: TaskHandlerRegistration): void {
  if (sealed) throw new Error('任务执行目录已经冻结');
  if (handlers.has(registration.taskType)) {
    logger.warn(`[task-center] 任务类型 "${registration.taskType}" 重复注册，已覆盖`);
  }
  handlers.set(registration.taskType, registration);
}

export function getTaskHandler(taskType: string): TaskHandlerRegistration | undefined {
  return handlers.get(taskType);
}

export function listTaskHandlers(): TaskHandlerRegistration[] {
  return [...handlers.values()].sort((a, b) => a.taskType.localeCompare(b.taskType));
}

/** 注册默认策略（未套用 DB 覆盖）；生效策略请用 config.ts 的 getTaskTypePolicy */
export function registrationDefaults(handler: TaskHandlerRegistration): TaskTypeRuntimePolicy {
  return {
    enabled: true,
    allowConcurrent: handler.allowConcurrent ?? true,
    maxAttempts: Math.min(Math.max(Math.trunc(handler.maxAttempts ?? 1), 1), 10),
    retryDelayMs: Math.min(Math.max(Math.trunc(handler.retryDelayMs ?? 5000), 1000), RETRY_BACKOFF_MAX_MS),
    retentionDays: handler.retentionDays ?? null,
  };
}

/** 基础元信息 + 指定策略合并为对外 Meta */
export function buildTaskTypeMeta(handler: TaskHandlerRegistration, policy: TaskTypeRuntimePolicy): AsyncTaskTypeMeta {
  return {
    taskType: handler.taskType,
    title: handler.title,
    module: handler.module,
    description: handler.description ?? null,
    allowConcurrent: policy.allowConcurrent,
    enabled: policy.enabled,
    maxAttempts: policy.maxAttempts,
    retryDelayMs: policy.retryDelayMs,
    retentionDays: policy.retentionDays,
  };
}

/** 同步版元信息（注册默认值，不含 DB 覆盖）：仅用于展示兜底（如 mapAsyncTask 的 module 字段） */
export function getTaskTypeMeta(taskType: string): AsyncTaskTypeMeta | null {
  const handler = handlers.get(taskType);
  if (!handler) return null;
  return buildTaskTypeMeta(handler, registrationDefaults(handler));
}
