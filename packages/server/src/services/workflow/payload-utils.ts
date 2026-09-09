import { isPlainObject } from '@zenith/shared/core';

/**
 * 作业 / 事件 payload（jsonb，形态未知）的安全读取：
 * 巡检与事件订阅投递记录都要从 `workflow_jobs.payload` 里取 eventId / eventType 等字段。
 */

/** payload 为普通对象时原样返回，否则返回空对象（数组、null、标量都视为无字段） */
export function payloadRecord(payload: unknown): Record<string, unknown> {
  return isPlainObject(payload) ? payload : {};
}

/** 读取字符串字段，非字符串返回 null */
export function payloadString(payload: unknown, key: string): string | null {
  const value = payloadRecord(payload)[key];
  return typeof value === 'string' ? value : null;
}
