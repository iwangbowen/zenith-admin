/**
 * 节点亲和任务：只能由提交它的进程执行——投递到该进程独有的队列，目标进程下线后由兜底扫描标记失败。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/types';
import { asyncTaskTypeConfigs } from '../../db/schema';

const mocks = vi.hoisted(() => ({
  send: vi.fn(), sendAfter: vi.fn(), handler: vi.fn(), select: vi.fn(), update: vi.fn(), transaction: vi.fn(), push: vi.fn(),
  nodeAlive: vi.fn(), registerQueue: vi.fn(), registerLocal: vi.fn(),
  insert: vi.fn(() => ({ values: () => ({ onConflictDoNothing: async () => undefined }) })),
}));
vi.mock('../../db', () => ({ db: { select: mocks.select, update: mocks.update, transaction: mocks.transaction, insert: mocks.insert } }));
vi.mock('../context', () => ({
  currentUser: () => ({ userId: 7, username: 'editor', roles: [], tenantId: null }),
  currentTraceId: () => undefined, currentParentRef: () => undefined,
  runWithCurrentUser: (_u: unknown, fn: () => unknown) => fn(), runWithTraceId: (_t: unknown, fn: () => unknown) => fn(), runWithParentRef: (_r: unknown, fn: () => unknown) => fn(),
}));
vi.mock('../process-identity', () => ({ PROCESS_HOSTNAME: 'node-a', PROCESS_PID: 11, PROCESS_ID: 'node-a:11' }));
vi.mock('../pg-boss-scheduler', () => ({
  registerSystemQueueWorker: mocks.registerQueue,
  registerLocalNodeQueueWorker: mocks.registerLocal,
  isSchedulerNodeAlive: mocks.nodeAlive,
  nodeQueueName: (base: string, nodeId: string) => `${base}/node/${nodeId.replace(/[^\w.-]+/g, '_')}`,
  sendSystemJob: mocks.send,
  sendSystemJobAfter: mocks.sendAfter,
}));
vi.mock('./registry', async (original) => ({
  ...await original<typeof import('./registry')>(), getTaskHandler: mocks.handler, listTaskHandlers: () => mocks.handler() ? [mocks.handler()] : [],
}));
vi.mock('./map', () => ({ pushTaskProgress: mocks.push }));

import { drainAsyncTasks, enqueueAsyncTask, persistAsyncTask, registerAsyncTaskWorker } from './runner';

const policy = { enabled: true, allowConcurrent: true, maxAttempts: 1, retryDelayMs: 5000, retentionDays: 30 };

function tx(): { tx: DbTransaction; inserted: () => Record<string, unknown> | undefined } {
  let inserted: Record<string, unknown> | undefined;
  const t = {
    execute: async () => undefined,
    select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => (table === asyncTaskTypeConfigs ? [policy] : []) }) }) }),
    insert: () => ({ values: (input: Record<string, unknown>) => { inserted = input; return { returning: async () => [{ id: 42, status: 'pending', ...input }] }; } }),
    $count: async () => 0,
  } as unknown as DbTransaction;
  return { tx: t, inserted: () => inserted };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue('job');
});

describe('提交', () => {
  it('affinity=node 的任务写入本进程标识；普通任务 nodeId 为 null', async () => {
    mocks.handler.mockReturnValue({ taskType: 'terminal-file-compress', title: '压缩', module: '文件', affinity: 'node', run: vi.fn() });
    const a = tx();
    await persistAsyncTask(a.tx, { taskType: 'terminal-file-compress' });
    expect(a.inserted()).toMatchObject({ nodeId: 'node-a:11' });

    mocks.handler.mockReturnValue({ taskType: 'export', title: '导出', module: '导出', run: vi.fn() });
    const b = tx();
    await persistAsyncTask(b.tx, { taskType: 'export' });
    expect(b.inserted()).toMatchObject({ nodeId: null });
  });
});

describe('投递', () => {
  it('按任务行的 nodeId 选择队列：节点亲和 → 该进程的节点队列，其余 → 共享队列', async () => {
    mocks.select.mockImplementation(() => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 1, nodeId: 'node-b:99' }] }) }) }));
    await enqueueAsyncTask(1);
    expect(mocks.send).toHaveBeenCalledWith('async-tasks/node/node-b_99', { taskId: 1 }, expect.objectContaining({ singletonKey: 'async-task-1' }));

    mocks.select.mockImplementation(() => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 2, nodeId: null }] }) }) }));
    await enqueueAsyncTask(2);
    expect(mocks.send).toHaveBeenLastCalledWith('async-tasks', { taskId: 2 }, expect.any(Object));
  });
});

describe('兜底扫描', () => {
  function drainFixture(pending: Array<{ id: number; nodeId: string | null }>) {
    // 三次 update：卡死已取消 → []；卡死未取消 → []；标记节点下线失败 → 返回被更新的行
    const failed: number[] = [];
    mocks.update.mockImplementation(() => ({
      set: (input: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (input.status === 'failed') { failed.push(1); return [{ id: 99, status: 'failed', createdBy: 7 }]; }
            return [];
          },
        }),
      }),
    }));
    mocks.select.mockImplementation(() => ({ from: () => ({ where: async () => pending }) }));
    return { failed };
  }

  it('目标进程仍在线的节点亲和任务照常重投；已下线的标记失败并推送进度', async () => {
    const f = drainFixture([{ id: 5, nodeId: 'node-b:1' }, { id: 6, nodeId: 'node-c:2' }, { id: 7, nodeId: null }]);
    mocks.nodeAlive.mockImplementation(async (nodeId: string) => nodeId === 'node-b:1');
    const result = await drainAsyncTasks();
    expect(mocks.send.mock.calls.map(([queue, data]) => [queue, data])).toEqual([
      ['async-tasks/node/node-b_1', { taskId: 5 }],
      ['async-tasks', { taskId: 7 }],
    ]);
    expect(f.failed).toHaveLength(1);
    expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }), { force: true });
    expect(result.redispatched).toBe(2);
  });
});

describe('注册 worker', () => {
  it('存在节点亲和任务类型时额外消费本进程的节点队列，否则只声明共享队列', async () => {
    mocks.select.mockImplementation(() => ({ from: () => ({ where: () => ({ limit: async () => [policy] }) }) }));
    mocks.handler.mockReturnValue({ taskType: 'terminal-file-compress', title: '压缩', module: '文件', affinity: 'node', run: vi.fn() });
    await registerAsyncTaskWorker();
    expect(mocks.registerQueue).toHaveBeenCalledWith(expect.objectContaining({ name: 'async-tasks' }));
    expect(mocks.registerLocal).toHaveBeenCalledWith('async-tasks', expect.any(Function), expect.any(Object));

    vi.clearAllMocks();
    mocks.handler.mockReturnValue({ taskType: 'export', title: '导出', module: '导出', run: vi.fn() });
    await registerAsyncTaskWorker();
    expect(mocks.registerLocal).not.toHaveBeenCalled();
  });
});
