import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const { select, count, execute, deleteLogRows, getSchedulerIntrospection, getSystemQueueMetrics } = vi.hoisted(() => ({
  select: vi.fn(),
  count: vi.fn(),
  execute: vi.fn(),
  deleteLogRows: vi.fn(),
  getSchedulerIntrospection: vi.fn(),
  getSystemQueueMetrics: vi.fn(),
}));

vi.mock('../../db', () => ({ db: { select, $count: count, execute } }));
vi.mock('../platform/log-cleanup', () => ({ deleteLogRows }));

vi.mock('../../lib/pg-boss-scheduler', () => ({
  getSchedulerIntrospection,
  getSystemQueueMetrics,
  runSystemRecurringJobNow: vi.fn(),
  updateSystemTaskRuntimePolicy: vi.fn(),
}));

import { cleanupSystemSchedulerRuns, listSystemSchedulerTasks } from './system-scheduler.service';
import { systemSchedulerRuns } from '../../db/schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(result: unknown[]): any {
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'groupBy', 'limit', 'as', 'crossJoinLateral']) c[m] = vi.fn(() => c);
  c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return c;
}

/**
 * listSystemSchedulerTasks 的 select 调用序（与任务数量无关）：
 *   1 运行统计 group by · 2 任务配置表 ·
 *   3-5 最近一次运行（LATERAL 子查询 / unnest × lateral / 按 id 取整行，只有 5 被 await）·
 *   6-8 最近一次告警（同上，只有 8 被 await）
 */
const SELECT_CALLS_PER_LIST = 8;

describe('cleanupSystemSchedulerRuns', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSchedulerIntrospection.mockReturnValue({ systemRecurringJobs: [taskInfo('cleanup')], systemQueueWorkers: [] });
    count.mockResolvedValueOnce(8).mockResolvedValueOnce(5);
    deleteLogRows.mockResolvedValue(3);
  });

  it('limits age cleanup to the selected task and preserves running records', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-11-13T08:00:00Z').getTime());
    try {
      await expect(cleanupSystemSchedulerRuns({ taskName: 'cleanup', days: 30 })).resolves.toMatchObject({ deletedByAge: 3, deletedByCount: 0, totalBefore: 8, totalAfter: 5 });
      expect(deleteLogRows.mock.calls[0][0]).toBe(systemSchedulerRuns);
      const query = new PgDialect({ casing: 'snake_case' }).sqlToQuery(deleteLogRows.mock.calls[0][1]);
      expect(query.sql).toContain('"system_scheduler_runs"."task_name" =');
      expect(query.sql).toContain('"system_scheduler_runs"."status" <>');
      expect(query.sql).toContain('"system_scheduler_runs"."started_at" <');
      expect(query.params).toEqual(['cleanup', 'running', '2026-10-14T08:00:00.000Z']);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it.each([undefined, 'cleanup'])('clears all finished runs without age or count pruning (task=%s)', async taskName => {
    await cleanupSystemSchedulerRuns({ taskName, days: 0 });
    const query = new PgDialect({ casing: 'snake_case' }).sqlToQuery(deleteLogRows.mock.calls[0][1]);
    expect(query.sql).toContain('"system_scheduler_runs"."status" <>');
    expect(query.sql).not.toContain('started_at');
    expect(query.params).toEqual(taskName ? [taskName, 'running'] : ['running']);
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps automatic retention policy cleanup when no days are provided', async () => {
    count.mockReset().mockResolvedValueOnce(8).mockResolvedValueOnce(5).mockResolvedValueOnce(4);
    await expect(cleanupSystemSchedulerRuns()).resolves.toMatchObject({ deletedByAge: 3, deletedByCount: 1, totalBefore: 8, totalAfter: 4 });
    expect(deleteLogRows).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(2);
    for (const [statement] of execute.mock.calls) {
      expect(new PgDialect({ casing: 'snake_case' }).sqlToQuery(statement).sql).toContain("r.status <> 'running'");
    }
  });

  it('rejects an unregistered task before counting or deleting', async () => {
    await expect(cleanupSystemSchedulerRuns({ taskName: 'missing', days: 0 })).rejects.toThrow('系统调度任务不存在或尚未注册');
    expect(count).not.toHaveBeenCalled();
    expect(deleteLogRows).not.toHaveBeenCalled();
  });
});

function queueSelects(results: { stats?: unknown[]; configs?: unknown[]; latest?: unknown[]; latestAlert?: unknown[] }) {
  const byCall: Record<number, unknown[]> = { 1: results.stats ?? [], 2: results.configs ?? [], 5: results.latest ?? [], 8: results.latestAlert ?? [] };
  let call = 0;
  select.mockImplementation(() => chain(byCall[++call] ?? []));
}

function taskInfo(name: string) {
  return {
    name,
    title: name,
    module: '测试',
    description: '',
    taskType: 'recurring',
    cronExpression: '0 * * * *',
    registeredAt: '2026-01-01 00:00:00',
    registeredNodeId: 'node',
    registeredHostname: 'host',
    registeredPid: 1,
    allowManualRun: true,
    enabled: true,
    logRetentionDays: 30,
    logRetentionRuns: 1000,
    timeoutMs: null,
    failureAlertThreshold: 1,
    alertEnabled: true,
    alertChannels: ['inapp'],
    alertUserIds: [],
    alertEmails: [],
    alertWebhookUrl: null,
    manualSingleton: true,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    lastDurationMs: null,
  };
}

function runRow(taskName: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    taskName,
    status: 'success',
    startedAt: new Date('2026-03-01T08:00:00Z'),
    durationMs: 12,
    resultMessage: 'ok',
    errorMessage: null,
    alertedAt: null,
    alertMessage: null,
    ...overrides,
  };
}

describe('listSystemSchedulerTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSystemQueueMetrics.mockResolvedValue({});
  });

  it('「最近一次运行 / 最近一次告警」各一条 LATERAL 语句，查询次数不随注册任务数增长', async () => {
    const names = Array.from({ length: 40 }, (_, i) => `task-${i}`);
    getSchedulerIntrospection.mockReturnValue({
      systemRecurringJobs: names.map(taskInfo),
      systemQueueWorkers: [],
      wip: [],
    });
    queueSelects({
      stats: [{ taskName: 'task-3', totalRuns: 5, successCount: 4, failedCount: 1, alertCount: 1 }],
      latest: [runRow('task-3', { id: 9, status: 'failed', errorMessage: 'boom' }), runRow('task-7', { id: 8 })],
      latestAlert: [runRow('task-3', { id: 5, alertedAt: new Date('2026-03-01T07:00:00Z'), alertMessage: '连续失败 1 次' })],
    });

    const tasks = await listSystemSchedulerTasks();

    expect(select).toHaveBeenCalledTimes(SELECT_CALLS_PER_LIST);
    expect(tasks).toHaveLength(40);

    const task3 = tasks.find((t) => t.name === 'task-3')!;
    expect(task3).toMatchObject({
      totalRuns: 5,
      successCount: 4,
      failedCount: 1,
      alertCount: 1,
      lastRunStatus: 'failed',
      lastRunMessage: 'boom',
      lastDurationMs: 12,
      lastAlertMessage: '连续失败 1 次',
    });
    expect(task3.lastRunAt).toBeTruthy();
    expect(task3.lastAlertAt).toBeTruthy();

    const task7 = tasks.find((t) => t.name === 'task-7')!;
    expect(task7).toMatchObject({ lastRunStatus: 'success', totalRuns: 0, lastAlertAt: null, lastAlertMessage: null });

    const untouched = tasks.find((t) => t.name === 'task-11')!;
    expect(untouched).toMatchObject({ lastRunAt: null, lastRunStatus: null, totalRuns: 0, lastAlertAt: null });
  });

  it('没有注册任务时同样只发固定数量的查询', async () => {
    getSchedulerIntrospection.mockReturnValue({ systemRecurringJobs: [], systemQueueWorkers: [], wip: [] });
    queueSelects({});

    await expect(listSystemSchedulerTasks()).resolves.toEqual([]);
    expect(select).toHaveBeenCalledTimes(SELECT_CALLS_PER_LIST);
  });
});
