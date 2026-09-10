import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ workers: vi.fn(), evaluate: vi.fn(), rolesWorker: false }));

vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./pg-boss-scheduler', () => ({ countActiveWorkerNodes: mocks.workers }));
vi.mock('../services/platform/monitor-alert.service', () => ({ evaluateMonitorAlerts: mocks.evaluate }));
vi.mock('../config', () => ({ config: { get roles() { return { api: true, worker: mocks.rolesWorker, list: [], label: 'api', explicit: true }; } } }));

import { runWorkerWatchdogCheckForTest, startWorkerWatchdog, stopWorkerWatchdog } from './worker-watchdog';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rolesWorker = false;
  mocks.evaluate.mockResolvedValue({ evaluated: 1, fired: 0, resolved: 0 });
});
afterEach(() => {
  stopWorkerWatchdog();
  vi.useRealTimers();
});

describe('worker watchdog（api 侧）', () => {
  it('有 worker 心跳时不评估任何规则', async () => {
    mocks.workers.mockResolvedValue(2);
    await runWorkerWatchdogCheckForTest();
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });

  it('没有 worker 心跳时只评估 schedulerWorkerNodes 指标的规则（其余留给 worker 侧的 cron 评估器）', async () => {
    mocks.workers.mockResolvedValue(0);
    await runWorkerWatchdogCheckForTest();
    expect(mocks.evaluate).toHaveBeenCalledTimes(1);
    expect(mocks.evaluate).toHaveBeenCalledWith({ metrics: ['schedulerWorkerNodes'] });
  });

  it('检查失败只记日志不抛出；上一轮未结束时跳过本轮', async () => {
    mocks.workers.mockRejectedValueOnce(new Error('db down'));
    await expect(runWorkerWatchdogCheckForTest()).resolves.toBeUndefined();

    let release!: () => void;
    mocks.workers.mockReturnValueOnce(new Promise<number>((resolve) => { release = () => resolve(0); }));
    const first = runWorkerWatchdogCheckForTest();
    await runWorkerWatchdogCheckForTest(); // 并发进入直接返回
    release();
    await first;
    expect(mocks.evaluate).toHaveBeenCalledTimes(1);
  });

  it('定时器按分钟触发；同时承担 worker 角色的进程不启动', () => {
    vi.useFakeTimers();
    mocks.workers.mockResolvedValue(1);
    startWorkerWatchdog();
    startWorkerWatchdog(); // 幂等
    vi.advanceTimersByTime(60_000);
    expect(mocks.workers).toHaveBeenCalledTimes(1);
    stopWorkerWatchdog();
    vi.advanceTimersByTime(60_000);
    expect(mocks.workers).toHaveBeenCalledTimes(1);

    mocks.rolesWorker = true;
    startWorkerWatchdog();
    vi.advanceTimersByTime(120_000);
    expect(mocks.workers).toHaveBeenCalledTimes(1);
  });
});
