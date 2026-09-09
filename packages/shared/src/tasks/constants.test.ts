import { describe, expect, it } from 'vitest';
import {
  ASYNC_TASK_ACTIVE_STATUSES,
  ASYNC_TASK_STATUSES,
  ASYNC_TASK_TERMINAL_STATUSES,
  isAsyncTaskTerminal,
} from './constants';

describe('async task status groups', () => {
  it('终态 + 进行中 恰好覆盖全部状态且互不重叠', () => {
    const union = [...ASYNC_TASK_ACTIVE_STATUSES, ...ASYNC_TASK_TERMINAL_STATUSES].sort();
    expect(union).toEqual([...ASYNC_TASK_STATUSES].sort());
    expect(ASYNC_TASK_ACTIVE_STATUSES.some((s) => (ASYNC_TASK_TERMINAL_STATUSES as readonly string[]).includes(s))).toBe(false);
  });

  it('isAsyncTaskTerminal 只对终态返回 true，空值与未知值返回 false', () => {
    for (const s of ASYNC_TASK_TERMINAL_STATUSES) expect(isAsyncTaskTerminal(s)).toBe(true);
    for (const s of ASYNC_TASK_ACTIVE_STATUSES) expect(isAsyncTaskTerminal(s)).toBe(false);
    expect(isAsyncTaskTerminal(null)).toBe(false);
    expect(isAsyncTaskTerminal(undefined)).toBe(false);
    expect(isAsyncTaskTerminal('expired')).toBe(false);
  });
});
