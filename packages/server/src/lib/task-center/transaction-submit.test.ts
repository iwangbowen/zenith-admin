import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from '../../db/types';

const mocks = vi.hoisted(() => ({
  sendSystemJob: vi.fn(),
  getTaskHandler: vi.fn(),
  getTaskTypePolicy: vi.fn(),
}));

vi.mock('../../db', () => ({ db: {} }));
vi.mock('../context', () => ({
  currentUser: () => ({ userId: 7, username: 'editor', roles: ['cms_editor'], tenantId: null }),
  runWithCurrentUser: (_user: unknown, fn: () => unknown) => Promise.resolve(fn()),
}));
vi.mock('../tenant', () => ({ getCreateTenantId: () => null }));
vi.mock('../pg-boss-scheduler', () => ({
  registerSystemQueueWorker: vi.fn(),
  sendSystemJob: mocks.sendSystemJob,
  sendSystemJobAfter: vi.fn(),
}));
vi.mock('./registry', () => ({ getTaskHandler: mocks.getTaskHandler }));
vi.mock('./config', () => ({
  ensureTaskTypeConfig: vi.fn(),
  getTaskTypePolicy: mocks.getTaskTypePolicy,
}));
vi.mock('./map', () => ({ pushTaskProgress: vi.fn() }));

import { enqueueAsyncTask, restartAsyncTask, submitAsyncTask } from './runner';

function executorWith(row: Record<string, unknown>) {
  const returning = vi.fn(async () => [row]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  return {
    executor: { insert, $count: vi.fn() } as unknown as DbExecutor,
    insert,
    values,
    returning,
  };
}

describe('task-center transactional outbox submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTaskHandler.mockReturnValue({ taskType: 'cms-publish-build', title: 'CMS 发布', module: 'CMS', run: vi.fn() });
    mocks.getTaskTypePolicy.mockResolvedValue({ enabled: true, allowConcurrent: true, maxAttempts: 3, retryDelayMs: 5000, retentionDays: 30 });
  });

  it('persists pending task through the provided transaction executor without enqueueing before commit', async () => {
    const row = { id: 42, taskType: 'cms-publish-build', title: 'CMS 发布', payload: {}, status: 'pending' };
    const fake = executorWith(row);
    const result = await submitAsyncTask({ taskType: 'cms-publish-build', payload: { siteId: 1 } }, { executor: fake.executor });
    expect(result).toBe(row);
    expect(fake.insert).toHaveBeenCalledTimes(1);
    expect(mocks.sendSystemJob).not.toHaveBeenCalled();

    await enqueueAsyncTask(42);
    expect(mocks.sendSystemJob).toHaveBeenCalledWith('async-tasks', { taskId: 42 }, expect.objectContaining({
      singletonKey: 'async-task-42',
    }));
  });

  it('does not enqueue or leak a task when the transactional insert fails', async () => {
    const executor = {
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => { throw new Error('tx rolled back'); }) })) })),
      $count: vi.fn(),
    } as unknown as DbExecutor;
    await expect(submitAsyncTask({ taskType: 'cms-publish-build' }, { executor })).rejects.toThrow('tx rolled back');
    expect(mocks.sendSystemJob).not.toHaveBeenCalled();
  });

  it('rejects attempts to enqueue from inside an external transaction', async () => {
    const fake = executorWith({ id: 1 });
    await expect(submitAsyncTask(
      { taskType: 'cms-publish-build' },
      { executor: fake.executor, enqueue: true },
    )).rejects.toThrow('外部事务内不能直接入队');
    expect(fake.insert).not.toHaveBeenCalled();
  });

  it('restarts and clears task items through an external transaction without enqueueing before commit', async () => {
    const row = { id: 42, taskType: 'cms-publish-build', status: 'pending' };
    const selectLimit = vi.fn(async () => [{ taskType: 'cms-publish-build' }]);
    const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: selectLimit })) })) }));
    const returning = vi.fn(async () => [row]);
    const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning })) })) }));
    const deleteWhere = vi.fn(async () => undefined);
    const delete_ = vi.fn(() => ({ where: deleteWhere }));
    const executor = { select, update, delete: delete_ } as unknown as DbExecutor;

    await expect(restartAsyncTask(42, { executor })).resolves.toBe(row);
    expect(delete_).toHaveBeenCalledTimes(1);
    expect(mocks.sendSystemJob).not.toHaveBeenCalled();
    await enqueueAsyncTask(42);
    expect(mocks.sendSystemJob).toHaveBeenCalledTimes(1);
  });
});
