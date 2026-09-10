/**
 * 纯 worker 进程的探针应用：只有健康 / 就绪 / 指标，没有业务路由。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ initialized: true, dbDown: false, topologyError: null as Error | null }));

vi.mock('../db', () => ({ db: { execute: async () => { if (mocks.dbDown) throw new Error('db down'); return []; } } }));
vi.mock('../lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../lib/invalidation-bus', async (original) => ({
  ...await original<typeof import('../lib/invalidation-bus')>(),
  invalidationBusState: () => 'listening',
}));
vi.mock('../lib/pg-boss-scheduler', () => ({
  getSchedulerIntrospection: () => ({ initialized: mocks.initialized }),
  purgeOrphanSystemTasks: vi.fn(),
  getQueueDepths: async () => [{ queue: 'async-tasks', ready: 5, deferred: 1, active: 2, failed: 0, total: 30 }],
  countActiveWorkerNodes: async () => 1,
}));
vi.mock('../lib/storage-topology', () => ({ assertWorkerStorageTopology: async () => { if (mocks.topologyError) throw mocks.topologyError; } }));
vi.mock('../lib/metrics-sampler', () => ({ metricsSampler: { getLatest: () => null, http: { totals: () => ({ total: 0, total4xx: 0, total5xx: 0 }) } } }));
vi.mock('../lib/ws-manager', () => ({ getWsSnapshot: () => ({ currentConnections: 0, currentUsers: 0 }) }));
vi.mock('../lib/ws-fanout', () => ({ getWsFanoutCounters: () => ({ published: 0, publishFailed: 0, delivered: 0, dropped: 0 }) }));
vi.mock('@hono/node-server', () => ({ serve: vi.fn(() => ({ close: (cb: () => void) => cb() })) }));

type RunWorker = typeof import('./run-worker');

async function load(roles: { api: boolean; worker: boolean }): Promise<RunWorker> {
  vi.resetModules();
  vi.doMock('../config', () => ({
    config: {
      roles: { ...roles, explicit: true, list: roles.api ? ['api', 'worker'] : ['worker'], label: roles.api ? 'all' : 'worker' },
      workerHealthPort: 3301,
      redis: { keyPrefix: 'test:' },
      log: { level: 'info', dir: 'logs', maxFiles: 1, pretty: false, viewerRoots: [] },
      otel: { enabled: false, serviceName: 'test', serviceVersion: 'test' },
    },
  }));
  const mod = await import('./run-worker');
  vi.doUnmock('../config');
  return mod;
}

afterEach(() => {
  mocks.initialized = true;
  mocks.dbDown = false;
  mocks.topologyError = null;
});

describe('createWorkerApp', () => {
  it('/health 与 /ready 输出角色与调度器状态；/metrics 为 Prometheus 文本；业务路径 404', async () => {
    const app = (await load({ api: false, worker: true })).createWorkerApp();
    const health = await app.request('/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ code: 0, data: { status: 'ok', roles: ['worker'], checks: { database: 'ok', scheduler: 'ok' } } });

    const ready = await app.request('/ready');
    expect(ready.status).toBe(200);

    const metrics = await app.request('/metrics');
    expect(metrics.status).toBe(200);
    const body = await metrics.text();
    expect(body).toContain('zenith_ws_fanout_published_total');
    // 队列积压与 worker 数是 worker 扩缩容 / 告警的信号，抓取时异步取数
    expect(body).toContain('zenith_pgboss_queue_jobs{queue="async-tasks",state="ready",process_role="worker"} 5');
    expect(body).toContain('zenith_scheduler_worker_nodes{process_role="worker"} 1');

    const business = await app.request('/api/auth/me');
    expect(business.status).toBe(404);
  });

  it('pg-boss 未启动时 /ready 返回 503，/health 标记 scheduler 错误', async () => {
    mocks.initialized = false;
    const app = (await load({ api: false, worker: true })).createWorkerApp();
    expect((await app.request('/ready')).status).toBe(503);
    const health = await (await app.request('/health')).json() as { data: { status: string; checks: Record<string, string> } };
    expect(health.data.checks.scheduler).toBe('error');
    expect(health.data.status).toBe('degraded');
  });
});

describe('startWorkerRole', () => {
  it('纯 worker 监听健康端口；与 api 同进程时不再开端口', async () => {
    const { serve } = await import('@hono/node-server');
    const pure = await load({ api: false, worker: true });
    await pure.startWorkerRole();
    expect(serve).toHaveBeenCalledWith(expect.objectContaining({ port: 3301 }));

    vi.mocked(serve).mockClear();
    const shared = await load({ api: true, worker: true });
    const handle = await shared.startWorkerRole();
    expect(serve).not.toHaveBeenCalled();
    await expect(handle.stopIngress()).resolves.toBeUndefined();
  });

  it('存储拓扑自检失败时抛错（由入口终止进程）', async () => {
    mocks.topologyError = new Error('需要共享卷');
    const { startWorkerRole } = await load({ api: false, worker: true });
    await expect(startWorkerRole()).rejects.toThrow('需要共享卷');
  });
});
