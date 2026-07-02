import type { AsyncTaskTypeMeta } from '@zenith/shared';
import logger from '../logger';
import type { TaskHandlerRegistration } from './types';

const handlers = new Map<string, TaskHandlerRegistration>();

/** 注册任务处理器（各业务模块在启动时调用；重复注册以最后一次为准） */
export function registerTaskHandler(registration: TaskHandlerRegistration): void {
  if (handlers.has(registration.taskType)) {
    logger.warn(`[task-center] 任务类型 "${registration.taskType}" 重复注册，已覆盖`);
  }
  handlers.set(registration.taskType, registration);
}

export function getTaskHandler(taskType: string): TaskHandlerRegistration | undefined {
  return handlers.get(taskType);
}

export function getTaskTypeMeta(taskType: string): AsyncTaskTypeMeta | null {
  const handler = handlers.get(taskType);
  if (!handler) return null;
  return {
    taskType: handler.taskType,
    title: handler.title,
    module: handler.module,
    description: handler.description ?? null,
    allowConcurrent: handler.allowConcurrent ?? true,
  };
}

export function listTaskTypeMetas(): AsyncTaskTypeMeta[] {
  return [...handlers.keys()].map((taskType) => getTaskTypeMeta(taskType)!)
    .sort((a, b) => a.taskType.localeCompare(b.taskType));
}
