import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/types';
import { asyncTasks, asyncTaskTypeConfigs } from '../../db/schema';

const mocks = vi.hoisted(() => ({
  send: vi.fn(), handler: vi.fn(), select: vi.fn(), transaction: vi.fn(), push: vi.fn(),
}));
vi.mock('../../db', () => ({ db: { select: mocks.select, transaction: mocks.transaction } }));
vi.mock('../context', () => ({
  currentUser: () => ({ userId: 7, username: 'editor', roles: [], tenantId: null }),
  currentTraceId: () => undefined, currentParentRef: () => undefined,
}));
vi.mock('../pg-boss-scheduler', () => ({
  registerSystemQueueWorker: vi.fn(), sendSystemJob: mocks.send, sendSystemJobAfter: vi.fn(),
}));
vi.mock('./registry', async (original) => ({
  ...await original<typeof import('./registry')>(), getTaskHandler: mocks.handler,
}));
vi.mock('./map', () => ({ pushTaskProgress: mocks.push }));

import { getTaskTypePolicy } from './config';
import { persistAsyncTask, restartAsyncTask, restartAsyncTaskInTransaction, submitAsyncTask } from './runner';

const policy = { enabled: true, allowConcurrent: true, maxAttempts: 3, retryDelayMs: 7300, retentionDays: 30 };
const row = { id: 42, taskType: 'cms-publish-build', status: 'pending', createdBy: 7, tenantId: null };

function fixture(options: { policy?: typeof policy | null; policyError?: Error; existing?: object; insertError?: Error; unfinished?: number } = {}) {
  const events: string[] = [];
  const values = vi.fn();
  const patch = vi.fn();
  const insert = vi.fn(() => ({
    values: (input: object) => {
      values(input);
      const returning = async () => {
        events.push('insert');
        if (options.insertError) throw options.insertError;
        return [{ ...row, ...input }];
      };
      return { returning, onConflictDoNothing: () => ({ returning }) };
    },
  }));
  const remove = vi.fn(() => ({ where: async () => { events.push('delete-items'); } }));
  const tx = {
    execute: async () => { events.push('lock'); },
    select: () => ({
      from: (table: unknown) => ({ where: () => ({ limit: async () => {
        if (table === asyncTaskTypeConfigs) {
          events.push('policy');
          if (options.policyError) throw options.policyError;
          return options.policy === null ? [] : [options.policy ?? policy];
        }
        expect(table).toBe(asyncTasks);
        return options.existing ? [options.existing] : [];
      } }) }),
    }),
    insert,
    update: () => ({ set: (input: object) => {
      patch(input);
      return { where: () => ({ returning: async () => [{ ...row, ...input }] }) };
    } }),
    delete: remove,
    $count: async () => options.unfinished ?? 0,
  } as unknown as DbTransaction;
  return { tx, events, values, patch, insert, remove };
}

describe('task-center transaction ownership and policy snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockImplementation(() => { throw new Error('global pool access forbidden'); });
    mocks.handler.mockReturnValue({ taskType: 'cms-publish-build', title: 'CMS publish', module: 'CMS', maxAttempts: 2, retryDelayMs: 6000, run: vi.fn() });
    mocks.send.mockResolvedValue('message-id');
  });

  it('reads the real policy through tx without any external side effect', async () => {
    const f = fixture();
    await expect(persistAsyncTask(f.tx, { taskType: 'cms-publish-build' })).resolves.toMatchObject({ maxAttempts: 3, retryDelayMs: 7300 });
    expect(f.events).toEqual(['lock', 'policy', 'insert']);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('propagates policy read failures before any insert', async () => {
    const f = fixture({ policyError: new Error('policy unavailable') });
    await expect(persistAsyncTask(f.tx, { taskType: 'cms-publish-build' })).rejects.toThrow('policy unavailable');
    expect(f.insert).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('uses registration defaults only for an absent override of a registered type', async () => {
    const f = fixture({ policy: null });
    await expect(getTaskTypePolicy(f.tx, 'cms-publish-build')).resolves.toMatchObject({ maxAttempts: 2, retryDelayMs: 6000 });
    mocks.handler.mockReturnValue(undefined);
    await expect(getTaskTypePolicy(f.tx, 'unknown')).rejects.toThrow();
  });

  it('rejects disabled and non-concurrent admissions before writing', async () => {
    for (const options of [
      { policy: { ...policy, enabled: false } },
      { policy: { ...policy, allowConcurrent: false }, unfinished: 1 },
    ]) {
      const f = fixture(options);
      await expect(persistAsyncTask(f.tx, { taskType: 'cms-publish-build' })).rejects.toThrow();
      expect(f.insert).not.toHaveBeenCalled();
    }
  });

  it('replays the existing task without replacing its policy snapshot', async () => {
    const existing = { ...row, maxAttempts: 1, retryDelayMs: 1200 };
    const f = fixture({ existing, policy: { ...policy, enabled: false } });
    await expect(persistAsyncTask(f.tx, { taskType: 'cms-publish-build', idempotencyKey: 'same-intent' })).resolves.toBe(existing);
    expect(f.events).toEqual(['lock']);
    expect(f.insert).not.toHaveBeenCalled();
  });

  it('publishes only after its transaction commits', async () => {
    const f = fixture();
    mocks.transaction.mockImplementation(async (fn: (tx: DbTransaction) => Promise<unknown>) => {
      f.events.push('begin');
      const result = await fn(f.tx);
      expect(mocks.send).not.toHaveBeenCalled();
      f.events.push('commit');
      return result;
    });
    mocks.send.mockImplementation(async () => { f.events.push('enqueue'); });
    await expect(submitAsyncTask({ taskType: 'cms-publish-build' })).resolves.toMatchObject({ id: 42 });
    expect(f.events).toEqual(['begin', 'lock', 'policy', 'insert', 'commit', 'enqueue']);
  });

  it('never publishes after a rollback', async () => {
    const f = fixture({ insertError: new Error('rollback') });
    mocks.transaction.mockImplementation((fn: (tx: DbTransaction) => Promise<unknown>) => fn(f.tx));
    await expect(submitAsyncTask({ taskType: 'cms-publish-build' })).rejects.toThrow('rollback');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('returns the committed pending task when transport fails', async () => {
    const f = fixture();
    mocks.transaction.mockImplementation((fn: (tx: DbTransaction) => Promise<unknown>) => fn(f.tx));
    mocks.send.mockRejectedValue(new Error('queue unavailable'));
    await expect(submitAsyncTask({ taskType: 'cms-publish-build' })).resolves.toMatchObject({ id: 42, status: 'pending' });
  });

  it('restarts within tx using a fresh policy snapshot and clears items before commit', async () => {
    const f = fixture({ existing: row, policy: { ...policy, maxAttempts: 5, retryDelayMs: 9500 } });
    await expect(restartAsyncTaskInTransaction(f.tx, 42)).resolves.toMatchObject({ attempts: 0, maxAttempts: 5, retryDelayMs: 9500 });
    expect(f.remove).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it('leaves the old task untouched if restart cannot read its policy', async () => {
    const f = fixture({ existing: row, policyError: new Error('policy unavailable') });
    mocks.transaction.mockImplementation((fn: (tx: DbTransaction) => Promise<unknown>) => fn(f.tx));
    await expect(restartAsyncTask(42)).rejects.toThrow('policy unavailable');
    expect(f.patch).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
