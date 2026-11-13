import { describe, expect, it } from 'vitest';
import { systemSchedulerCleanupQuery } from './contracts/system-scheduler';

describe('system scheduler cleanup query', () => {
  it('keeps the per-task policy when days is omitted', () => {
    expect(systemSchedulerCleanupQuery.parse({})).toEqual({});
    expect(systemSchedulerCleanupQuery.parse({ taskName: 'cleanup' })).toEqual({ taskName: 'cleanup' });
  });
  it.each([0, 30, 90, 180, 365, 3650])('accepts explicit retention days %i with task scope', days => {
    expect(systemSchedulerCleanupQuery.parse({ taskName: 'cleanup', days: String(days) })).toEqual({ taskName: 'cleanup', days });
  });
  it.each(['', ' ', null, false, true, -1, 'abc', 0.5, 3651])('rejects ambiguous or invalid days %j', days => {
    expect(systemSchedulerCleanupQuery.safeParse({ days }).success).toBe(false);
  });
});
