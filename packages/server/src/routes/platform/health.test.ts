import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workerNodes: 1,
  dbDown: false,
  fanout: 'subscribed' as string,
  bus: 'listening' as string,
  scheduler: true,
  startupReady: true,
}));

vi.mock('../../db', () => ({
  db: {
    execute: async () => { if (mocks.dbDown) throw new Error('db down'); return []; },
    $count: async () => mocks.workerNodes,
  },
}));
vi.mock('../../lib/invalidation-bus', async (original) => ({
  ...await original<typeof import('../../lib/invalidation-bus')>(),
  invalidationBusState: () => mocks.bus,
}));
vi.mock('../../lib/ws-fanout', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/ws-fanout')>(),
  wsFanoutState: () => mocks.fanout,
}));
vi.mock('../../lib/health-probe-state', () => ({ isApplicationStartupReady: () => mocks.startupReady }));
vi.mock('../../lib/pg-boss-scheduler', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/pg-boss-scheduler')>(),
  countActiveWorkerNodes: async () => mocks.workerNodes,
  getSchedulerIntrospection: () => ({ initialized: mocks.scheduler }),
}));
vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } }));

type HealthApp = typeof import('./health').default;

const stubConfigBase = {
  // 契约路由适配层静态引入 authMiddleware（模块加载期即构造 JWT 中间件），健康检查本身不鉴权
  jwtSecret: 'test-secret',
  redis: { keyPrefix: 'test:' },
  log: { level: 'info', dir: 'logs', maxFiles: 1, pretty: false },
  otel: { enabled: false, serviceName: 'test', serviceVersion: 'test' },
};

async function loadHealth(roles: { api: boolean; worker: boolean; list: string[] }): Promise<HealthApp> {
  vi.resetModules();
  vi.doMock('../../config', () => ({ config: { ...stubConfigBase, roles: { ...roles, explicit: true, label: roles.list.join(',') } } }));
  try {
    return (await import('./health')).default;
  } finally {
    vi.doUnmock('../../config');
  }
}

async function check(app: HealthApp) {
  const res = await app.request('/');
  return { status: res.status, body: (await res.json()) as { data: { status: string; roles: string[]; checks: Record<string, string> } } };
}

async function probe(app: HealthApp, path: string) {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as { data: { status: string; ready: boolean; version: string; roles: string[]; checks: Record<string, string> } } };
}

// Contract routing and the scheduler load the complete shared/schema graph.
// Compile it once as suite setup; each role still gets fresh module state and
// every request/expectation keeps the normal 15-second test deadline.
beforeAll(async () => {
  await loadHealth({ api: true, worker: false, list: ['api'] });
}, 120_000);

afterEach(() => {
  vi.doUnmock('../../config');
  mocks.workerNodes = 1;
  mocks.dbDown = false;
  mocks.fanout = 'subscribed';
  mocks.bus = 'listening';
  mocks.scheduler = true;
  mocks.startupReady = true;
});

describe('canonical probes', () => {
  it('returns the complete probe shape and keeps optional fan-out degradation ready', async () => {
    mocks.fanout = 'degraded';
    const app = await loadHealth({ api: true, worker: false, list: ['api'] });
    const live = await probe(app, '/livez');
    expect(live.status).toBe(200);
    expect(live.body.data).toMatchObject({ status: 'ok', ready: true, version: expect.any(String), roles: ['api'], checks: { process: 'ok' } });

    const startup = await probe(app, '/startupz');
    expect(startup.status).toBe(200);
    expect(startup.body.data).toMatchObject({ ready: true, checks: { process: 'ok', application: 'ok', scheduler: 'ok' } });

    const ready = await probe(app, '/readyz');
    expect(ready.status).toBe(200);
    expect(ready.body.data).toMatchObject({ status: 'degraded', ready: true, checks: { database: 'ok', redis: 'ok', wsFanout: 'degraded', workers: 'ok' } });
  });

  it('returns 503 while startup or readiness required dependencies are unavailable', async () => {
    mocks.startupReady = false;
    const app = await loadHealth({ api: true, worker: false, list: ['api'] });
    expect((await probe(app, '/startupz')).status).toBe(503);
    expect((await probe(app, '/readyz')).status).toBe(503);

    mocks.startupReady = true;
    mocks.scheduler = false;
    expect((await probe(app, '/readyz')).status).toBe(503);
    mocks.scheduler = true;
    mocks.dbDown = true;
    expect((await probe(app, '/readyz')).status).toBe(503);
  });
});

describe('GET /api/health 按角色输出', () => {
  it('api 角色：带 roles，并检查 fan-out 订阅与活跃 worker 心跳', async () => {
    const { status, body } = await check(await loadHealth({ api: true, worker: false, list: ['api'] }));
    expect(status).toBe(200);
    expect(body.data.roles).toEqual(['api']);
    expect(body.data.checks).toMatchObject({ database: 'ok', redis: 'ok', invalidationBus: 'ok', wsFanout: 'ok', workers: 'ok' });
    expect(body.data.status).toBe('ok');
  });

  it('api 角色近期无 worker 心跳 → workers 降级（作业会排队但无人执行），整体同步降级', async () => {
    mocks.workerNodes = 0;
    mocks.fanout = 'degraded';
    const { body } = await check(await loadHealth({ api: true, worker: false, list: ['api'] }));
    expect(body.data.checks.workers).toBe('degraded');
    expect(body.data.checks.wsFanout).toBe('degraded');
    expect(body.data.status).toBe('degraded');
  });

  it('自身承担 worker 角色时 workers 天然为 ok；数据库故障整体降级', async () => {
    mocks.workerNodes = 0;
    const ok = await check(await loadHealth({ api: true, worker: true, list: ['api', 'worker'] }));
    expect(ok.body.data.checks.workers).toBe('ok');
    expect(ok.body.data.roles).toEqual(['api', 'worker']);

    mocks.dbDown = true;
    const down = await check(await loadHealth({ api: true, worker: true, list: ['api', 'worker'] }));
    expect(down.body.data.checks.database).toBe('error');
    expect(down.body.data.status).toBe('degraded');
  });
});
