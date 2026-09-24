import { afterEach, describe, expect, it, vi } from 'vitest';
import { asyncTaskTypeConfigs } from '../../db/schema';

const mocks = vi.hoisted(() => ({ update: vi.fn(), select: vi.fn(), sendAfter: vi.fn(), run: vi.fn() }));
vi.mock('../../db', () => ({ db: { update: mocks.update, select: mocks.select } }));
vi.mock('../pg-boss-scheduler', () => ({ getSystemJobState: vi.fn(async () => null), registerSystemQueueWorker: vi.fn(), sendSystemJob: vi.fn(), sendSystemJobAfter: mocks.sendAfter }));
vi.mock('./map', () => ({ pushTaskProgress: vi.fn() }));
vi.mock('./registry', () => ({ getTaskHandler: () => ({ run: mocks.run }) }));
vi.mock('../context', () => ({ runWithParentRef: (_ref: string, fn: () => unknown) => fn() }));

import { runAsyncTask } from './runner';

afterEach(() => vi.useRealTimers());

describe('automatic retry policy snapshots', () => {
  it('schedules retry from the saved snapshot without reading the policy table', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T00:00:00Z'));
    const claimed = { dispatchToken: '00000000-0000-4000-8000-000000000042', id: 42, taskType: 'probe', title: 'Probe', attempts: 2, maxAttempts: 5, retryDelayMs: 7300, createdBy: null, traceId: null };
    const updates: Record<string, unknown>[] = [];
    mocks.update.mockImplementation(() => ({ set: (patch: Record<string, unknown>) => {
      updates.push(patch);
      return { where: () => ({ returning: async () => [{ ...claimed, ...patch, attempts: 2 }] }) };
    } }));
    mocks.select.mockImplementation(() => ({ from: (table: unknown) => {
      expect(table).not.toBe(asyncTaskTypeConfigs);
      return { where: () => ({ limit: async () => [{ ...claimed, ...updates.at(-1), cancelRequested: false }] }) };
    } }));
    mocks.run.mockRejectedValue(new Error('temporary failure'));
    mocks.sendAfter.mockResolvedValue('message');
    await runAsyncTask(42);
    expect(updates.at(-1)).toMatchObject({ status: 'pending', nextRunAt: new Date('2026-09-08T00:00:14.600Z') });
    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(mocks.sendAfter).toHaveBeenCalledWith('async-tasks', expect.objectContaining({ taskId: 42, dispatchToken: expect.any(String) }), new Date('2026-09-08T00:00:14.600Z'), expect.any(Object));
  });
});
