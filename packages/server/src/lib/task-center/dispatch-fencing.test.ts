import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { TaskRunContext } from './types';
const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, handler: vi.fn(), select: vi.fn(), update: vi.fn(), insert: vi.fn(), complete: vi.fn() }));
vi.mock('../../db', () => ({ db: { select: mocks.select, update: mocks.update, insert: mocks.insert, transaction: (fn: (tx: unknown) => unknown) => fn({ select: mocks.select, update: mocks.update, insert: mocks.insert }) }, withoutDbExecutor: (fn: () => unknown) => fn() }));
vi.mock('../context', () => ({ runWithParentRef: (_ref: string, fn: () => unknown) => fn() }));
vi.mock('./registry', () => ({ getTaskHandler: () => ({ run: mocks.handler }) }));
vi.mock('./map', () => ({ pushTaskProgress: vi.fn() }));
vi.mock('./terminal-events', () => ({ completeAsyncTasks: mocks.complete }));
vi.mock('../pg-boss-scheduler', () => ({ getSystemJobState: vi.fn(), registerSystemQueueWorker: vi.fn(), sendSystemJob: vi.fn(), sendSystemJobAfter: vi.fn() }));
import { runAsyncTask } from './runner';
const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
function matches(where: SQL) {
  const tokens = new PgDialect().sqlToQuery(where).params.filter((value) => value === first || value === second);
  return tokens.every((token) => token === mocks.state.dispatchToken);
}
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { id: 8, taskType: 'fencing-test', title: 'Fence', status: 'pending', dispatchToken: first, attempts: 0, maxAttempts: 2, createdBy: null, payload: {}, checkpoint: null, cancelRequested: false };
  mocks.select.mockImplementation(() => ({ from: () => ({ where: (condition: SQL) => {
    const query = { limit: async () => matches(condition) ? [{ ...mocks.state }] : [], for: () => query }; return query;
  } }) }));
  mocks.update.mockImplementation(() => ({ set: (patch: Record<string, unknown>) => ({ where: (condition: SQL) => ({ returning: async () => {
    if (!matches(condition)) return [];
    mocks.state = { ...mocks.state, ...patch, ...(patch.status === 'running' ? { attempts: 1 } : {}) };
    return [{ ...mocks.state }];
  } }) }) }));
});
describe('task execution-round fencing', () => {
  it('renews the running lease during long handler work and stops heartbeating when it finishes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    mocks.handler.mockImplementation(async () => { entered.resolve(); await finish.promise; return { done: true }; });
    mocks.complete.mockResolvedValueOnce([{ ...mocks.state, status: 'success' }]);

    const run = runAsyncTask(8, first);
    await entered.promise;
    const claimedAt = mocks.state.heartbeatAt as Date;

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.state.heartbeatAt).toEqual(new Date(claimedAt.getTime() + 30_000));

    finish.resolve();
    await run;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it('does not let a recovered old worker overwrite new progress, items, or completion', async () => {
    const entered = Promise.withResolvers<TaskRunContext>();
    const finish = Promise.withResolvers<void>();
    mocks.handler.mockImplementation(async (ctx: TaskRunContext) => { entered.resolve(ctx); await finish.promise; return { stale: true }; });
    const run = runAsyncTask(8, first);
    const ctx = await entered.promise;
    mocks.state = { ...mocks.state, dispatchToken: second, status: 'running', checkpoint: { newer: true } };
    expect(await ctx.progress({ processed: 99, checkpoint: { stale: true } })).toEqual({ cancelRequested: true });
    expect(await ctx.isCancelRequested()).toBe(true);
    await ctx.reportItems([{ key: 'old', status: 'success' }]);
    expect(mocks.insert).not.toHaveBeenCalled();
    finish.resolve(); await run;
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.state.checkpoint).toEqual({ newer: true });
  });
});
