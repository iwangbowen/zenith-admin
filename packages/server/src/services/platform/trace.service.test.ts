/**
 * 最近链路列表：两阶段查询的候选合并与状态汇总口径。
 * 阶段 1（四锚点采样）→ 阶段 2（按 traceId 分组计数），select 调用顺序即 Promise.all 的创建顺序。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db', () => ({ db: { select: vi.fn() } }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 1, username: 'admin', tenantId: null, roles: [] }) }));
vi.mock('../../lib/tenant', () => ({ tenantCondition: () => undefined }));

import { db } from '../../db';
import { listRecentTraces } from './trace.service';

const dbMock = vi.mocked(db);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function selectChain(result: unknown): any {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy', 'limit', 'groupBy']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

/** 按 select 调用顺序排队：阶段 1 = 请求/作业/任务/通知样本，阶段 2 = 对应的分组计数 */
function queueResults(results: unknown[]) {
  dbMock.select.mockImplementation(() => selectChain(results.shift()));
}

const T = (iso: string) => new Date(iso);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listRecentTraces', () => {
  it('同一 traceId 跨锚点合并为一行：ts 取最近活动，入口摘要优先请求', async () => {
    queueResults([
      // 阶段 1：请求 / 作业 / 任务 / 通知样本
      [{ traceId: 't-1', ts: T('2026-09-27T10:00:00Z'), method: 'POST', path: '/api/orders' }],
      [
        { traceId: 't-1', ts: T('2026-09-27T11:00:00Z'), jobType: 'webhook_delivery' },
        { traceId: 't-2', ts: T('2026-09-27T09:00:00Z'), jobType: 'webhook_delivery' },
      ],
      [{ traceId: 't-2', ts: T('2026-09-27T09:30:00Z'), title: '数据导入' }],
      [{ traceId: 't-3', ts: T('2026-09-27T08:00:00Z'), eventKey: 'order.created' }],
      // 阶段 2：分组计数
      [{ traceId: 't-1', bucket: 200, n: 1 }],
      [
        { traceId: 't-1', bucket: 'succeeded', n: 1 },
        { traceId: 't-1', bucket: 'dead', n: 1 },
        { traceId: 't-2', bucket: 'running', n: 2 },
      ],
      [{ traceId: 't-2', bucket: 'success', n: 1 }],
      [{ traceId: 't-3', bucket: 'pending', n: 1 }],
    ]);

    const entries = await listRecentTraces({});

    expect(entries.map((e) => e.traceId)).toEqual(['t-1', 't-2', 't-3']);
    // t-1 的入口摘要是请求而非更晚的作业
    expect(entries[0]).toMatchObject({
      title: 'POST /api/orders',
      status: 'failed',
      nodeCount: 3,
      failedCount: 1,
    });
    // t-2 无请求，入口取作业类型（优先级高于任务标题）
    expect(entries[1]).toMatchObject({ title: 'webhook_delivery', status: 'running', nodeCount: 3, failedCount: 0 });
    expect(entries[2]).toMatchObject({ title: 'order.created', status: 'pending', nodeCount: 1, failedCount: 0 });
  });

  it('请求节点成败由响应码派生：500 为失败，null 视同 200 成功', async () => {
    queueResults([
      [
        { traceId: 't-500', ts: T('2026-09-27T10:00:00Z'), method: 'POST', path: '/api/pay' },
        { traceId: 't-null', ts: T('2026-09-27T09:00:00Z'), method: 'GET', path: '/api/orders' },
      ],
      [],
      [],
      [],
      [
        { traceId: 't-500', bucket: 500, n: 1 },
        { traceId: 't-null', bucket: null, n: 2 },
      ],
      [],
      [],
      [],
    ]);

    const entries = await listRecentTraces({});

    expect(entries[0]).toMatchObject({ traceId: 't-500', status: 'failed', nodeCount: 1, failedCount: 1 });
    expect(entries[1]).toMatchObject({ traceId: 't-null', status: 'success', nodeCount: 2, failedCount: 0 });
  });

  it('全成功链路汇总为 success', async () => {
    queueResults([
      [{ traceId: 't-ok', ts: T('2026-09-27T10:00:00Z'), method: 'GET', path: '/api/orders' }],
      [{ traceId: 't-ok', ts: T('2026-09-27T10:01:00Z'), jobType: 'report_build' }],
      [],
      [],
      [{ traceId: 't-ok', bucket: 201, n: 1 }],
      [{ traceId: 't-ok', bucket: 'succeeded', n: 2 }],
      [],
      [],
    ]);

    const entries = await listRecentTraces({});

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: 'success', nodeCount: 3, failedCount: 0 });
  });

  it('没有候选时返回空数组且不做阶段 2 查询', async () => {
    queueResults([[], [], [], []]);

    await expect(listRecentTraces({})).resolves.toEqual([]);
    expect(dbMock.select).toHaveBeenCalledTimes(4);
  });
});
