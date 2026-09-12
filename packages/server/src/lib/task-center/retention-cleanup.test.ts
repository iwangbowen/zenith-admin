/**
 * 任务保留期清理：类型级覆盖各按自身保留期、其余类型走全局保留期；
 * 清理（DELETE）与「数据保留策略」预览计数必须是同一组条件。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({
  overrides: [] as { taskType: string; retentionDays: number | null }[],
  deleted: [] as SQL[],
  counted: [] as SQL[],
}));
vi.mock('../../db', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => mocks.overrides }) }),
    delete: () => ({ where: (w: SQL) => { mocks.deleted.push(w); return { returning: async () => [{ id: 1 }, { id: 2 }] }; } }),
    $count: async (_t: unknown, w: SQL) => { mocks.counted.push(w); return 3; },
  },
}));
vi.mock('../context', () => ({
  currentUser: () => null, currentTraceId: () => undefined, currentParentRef: () => undefined,
  runWithCurrentUser: (_u: unknown, fn: () => unknown) => fn(), runWithTraceId: (_t: unknown, fn: () => unknown) => fn(), runWithParentRef: (_r: unknown, fn: () => unknown) => fn(),
}));
vi.mock('../process-identity', () => ({ PROCESS_HOSTNAME: 'node-a', PROCESS_PID: 11, PROCESS_ID: 'node-a:11' }));
vi.mock('../pg-boss-scheduler', () => ({
  registerSystemQueueWorker: vi.fn(), registerLocalNodeQueueWorker: vi.fn(), isSchedulerNodeAlive: vi.fn(), ensureLocalNodeQueue: vi.fn(),
  isQueueNotFoundError: () => false, nodeQueueName: (base: string, nodeId: string) => `${base}/node/${nodeId}`,
  sendSystemJob: vi.fn(), sendSystemJobAfter: vi.fn(),
}));
vi.mock('./map', () => ({ pushTaskProgress: vi.fn() }));

import { cleanupAsyncTasks, countCleanableAsyncTasks } from './runner';

// 与 db/index.ts 相同的列名 casing，渲染出的 SQL 才与真实执行一致
const dialect = new PgDialect({ casing: 'snake_case' });
const render = (w: SQL) => dialect.sqlToQuery(w).sql;

beforeEach(() => {
  mocks.overrides = [];
  mocks.deleted = [];
  mocks.counted = [];
  vi.useFakeTimers({ now: new Date('2026-09-12T12:00:00Z') });
});

describe('cleanupAsyncTasks / countCleanableAsyncTasks', () => {
  it('无类型级覆盖：只有一组全局条件（终态 + 截止时间），不带 NOT IN', async () => {
    expect(await cleanupAsyncTasks(30)).toBe(2);
    expect(mocks.deleted).toHaveLength(1);
    const sql = render(mocks.deleted[0]);
    expect(sql).toContain('"status" in');
    expect(sql).toContain('"completed_at" <');
    expect(sql).not.toContain('not in');
  });

  it('有覆盖：先按类型各清一组，再清「其余类型」的全局一组；retentionDays 为空的覆盖被忽略', async () => {
    mocks.overrides = [
      { taskType: 'export', retentionDays: 7 },
      { taskType: 'skipped', retentionDays: null },
      { taskType: 'import', retentionDays: 3 },
    ];
    expect(await cleanupAsyncTasks(30)).toBe(6);
    expect(mocks.deleted).toHaveLength(3);
    expect(render(mocks.deleted[0])).toContain('"task_type" = ');
    expect(render(mocks.deleted[1])).toContain('"task_type" = ');
    const rest = render(mocks.deleted[2]);
    expect(rest).toContain('"task_type" not in');
    expect(dialect.sqlToQuery(mocks.deleted[2]).params).toEqual(expect.arrayContaining(['export', 'import']));
    expect(dialect.sqlToQuery(mocks.deleted[2]).params).not.toContain('skipped');
  });

  it('预览计数与清理使用完全相同的一组条件（同口径）', async () => {
    mocks.overrides = [{ taskType: 'export', retentionDays: 7 }];
    await cleanupAsyncTasks(30);
    expect(await countCleanableAsyncTasks(30)).toBe(6);
    expect(mocks.counted.map((w) => dialect.sqlToQuery(w))).toEqual(mocks.deleted.map((w) => dialect.sqlToQuery(w)));
  });
});
