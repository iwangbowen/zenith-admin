import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ workerNodes: 1, dbDown: false, fanout: 'subscribed' as string, bus: 'listening' as string }));

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
vi.mock('../../lib/ws-fanout', () => ({ wsFanoutState: () => mocks.fanout }));
vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } }));

type HealthApp = typeof import('./health').default;

const stubConfigBase = {
  redis: { keyPrefix: 'test:' },
  log: { level: 'info', dir: 'logs', maxFiles: 1, pretty: false, viewerRoots: [] },
  otel: { enabled: false, serviceName: 'test', serviceVersion: 'test' },
};

async function loadHealth(roles: { api: boolean; worker: boolean; list: string[] }): Promise<HealthApp> {
  vi.resetModules();
  vi.doMock('../../config', () => ({ config: { ...stubConfigBase, roles: { ...roles, explicit: true, label: roles.list.join(',') } } }));
  const mod = await import('./health');
  vi.doUnmock('../../config');
  return mod.default;
}

async function check(app: HealthApp) {
  const res = await app.request('/');
  return { status: res.status, body: (await res.json()) as { data: { status: string; roles: string[]; checks: Record<string, string> } } };
}

afterEach(() => {
  mocks.workerNodes = 1;
  mocks.dbDown = false;
  mocks.fanout = 'subscribed';
  mocks.bus = 'listening';
});

describe('GET /api/health 按角色输出', () => {
  it('api 角色：带 roles，并检查 fan-out 订阅与活跃 worker 心跳', async () => {
    const { status, body } = await check(await loadHealth({ api: true, worker: false, list: ['api'] }));
    expect(status).toBe(200);
    expect(body.data.roles).toEqual(['api']);
    expect(body.data.checks).toMatchObject({ database: 'ok', redis: 'ok', invalidationBus: 'ok', wsFanout: 'ok', workers: 'ok' });
    expect(body.data.status).toBe('ok');
  });

  it('api 角色近期无 worker 心跳 → workers 降级（作业会排队但无人执行），整体仍为 ok', async () => {
    mocks.workerNodes = 0;
    mocks.fanout = 'degraded';
    const { body } = await check(await loadHealth({ api: true, worker: false, list: ['api'] }));
    expect(body.data.checks.workers).toBe('degraded');
    expect(body.data.checks.wsFanout).toBe('degraded');
    expect(body.data.status).toBe('ok');
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
