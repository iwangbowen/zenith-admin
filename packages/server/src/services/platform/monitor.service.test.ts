/**
 * WebSocket 连接监控的可见范围（与「在线用户」页 visibleSessions 同口径）。
 *
 * 连接明细带 userId / 昵称 / IP / UA，租户管理员经本接口看到他租户或平台超管的连接
 * 属于越权数据暴露，且强制下线动作也只允许操作可见范围内的会话，
 * 所以这里把两层都锁住：范围判定本身 + getWsMetrics 的裁剪结果。
 *
 * 租户工具（getTenantScopeId / isPlatformAdmin）只在这里替换取值，语义本身由 lib/tenant.test.ts 覆盖。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WSContext } from 'hono/ws';

const state = {
  scope: undefined as number | null | undefined,
  platformAdmin: true,
  /** users 表查询结果 */
  rows: [] as Array<{ id: number; username: string; nickname: string; tenantId: number | null }>,
  /** 持平台超管角色的用户 */
  superUserIds: new Set<number>(),
};

vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 1 }) }));
vi.mock('../../lib/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/tenant')>()),
  getTenantScopeId: () => state.scope,
  isPlatformAdmin: () => state.platformAdmin,
}));
vi.mock('../identity/role-grant', () => ({
  listPlatformSuperUserIds: vi.fn(async () => state.superUserIds),
}));
vi.mock('../../db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => state.rows,
      }),
    }),
  },
}));

type WsManager = typeof import('../../lib/ws-manager');
type MonitorService = typeof import('./monitor.service');

let m: WsManager;
let service: MonitorService;

function fakeWs() {
  return { send: vi.fn(), close: vi.fn() } as unknown as WSContext;
}

/** 平台超管（租户为空）、无租户的普通管理员、租户 1 的两人（其一持平台超管角色）、租户 2 一人 */
const USER_ROWS = [
  { id: 1, username: 'super', nickname: '超管', tenantId: null },
  { id: 2, username: 'ops', nickname: '运维', tenantId: null },
  { id: 10, username: 't1-a', nickname: '租户一甲', tenantId: 1 },
  { id: 11, username: 't1-b', nickname: '租户一乙', tenantId: 1 },
  { id: 20, username: 't2-a', nickname: '租户二甲', tenantId: 2 },
];

async function loadMonitor() {
  // 模块级连接表在用例间隔离；monitor.service 与 ws-manager 必须拿到同一份新实例
  vi.resetModules();
  m = await import('../../lib/ws-manager');
  service = await import('./monitor.service');
}

// Cold compilation of shared contracts/schema belongs to suite setup, with
// real timers available to the module loader. Individual cases stay at 15s.
beforeAll(loadMonitor, 120_000);

beforeEach(async () => {
  state.rows = [...USER_ROWS];
  state.superUserIds = new Set([1, 11]);
  state.scope = undefined;
  state.platformAdmin = true;
  await loadMonitor();
  vi.useFakeTimers();
});

afterEach(() => {
  if (vi.isFakeTimers()) {
    // Discard the presence-flush debounce belonging to this case's manager.
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});

describe('resolveVisibleWsUserIds（可见范围判定）', () => {
  const candidates = USER_ROWS.map(({ id, tenantId }) => ({ id, tenantId }));

  const resolve = (overrides: Partial<Parameters<MonitorService['resolveVisibleWsUserIds']>[1]>) =>
    service.resolveVisibleWsUserIds(candidates, {
      scope: undefined,
      platformAdmin: false,
      platformSuperUserIds: state.superUserIds,
      ...overrides,
    });

  it('平台管理员在平台视角不过滤（返回 null）', () => {
    expect(resolve({ scope: undefined, platformAdmin: true })).toBeNull();
  });

  it('平台管理员切到租户视角只看该租户，且不过滤该租户内的超管', () => {
    expect([...(resolve({ scope: 1, platformAdmin: true }) ?? [])].sort()).toEqual([10, 11]);
    expect([...(resolve({ scope: 2, platformAdmin: true }) ?? [])]).toEqual([20]);
  });

  it('租户管理员只看本租户，且看不到持平台超管角色的用户', () => {
    expect([...(resolve({ scope: 1, platformAdmin: false }) ?? [])]).toEqual([10]);
  });

  it('无租户的非平台管理员只落到无租户用户', () => {
    expect([...(resolve({ scope: null, platformAdmin: false }) ?? [])]).toEqual([2]);
  });
});

describe('getWsMetrics 可见范围裁剪', () => {
  /** 每个用例都重新登记连接：beforeEach 已隔离模块，连接表为空 */
  function seedConnections() {
    for (const id of [1, 2, 10, 20]) m.registerConnection(id, `jti-${id}`, fakeWs());
  }

  it('平台管理员看到全部连接，统计与明细同口径', async () => {
    seedConnections();
    const metrics = await service.getWsMetrics();
    expect(metrics.connections.map((c) => c.userId).sort((a, b) => a - b)).toEqual([1, 2, 10, 20]);
    expect(metrics.currentConnections).toBe(4);
    expect(metrics.currentUsers).toBe(4);
    expect(metrics.connections.find((c) => c.userId === 10)?.nickname).toBe('租户一甲');
  });

  it('平台管理员切到租户 1 只看到该租户的连接', async () => {
    seedConnections();
    state.scope = 1;
    const metrics = await service.getWsMetrics();
    expect(metrics.connections.map((c) => c.userId)).toEqual([10]);
    expect(metrics.currentConnections).toBe(1);
    expect(metrics.currentUsers).toBe(1);
  });

  it('租户管理员看不到他租户与平台超管的连接，断开记录同样受限', async () => {
    const own = fakeWs();
    const otherTenant = fakeWs();
    const platformSuper = fakeWs();
    m.registerConnection(10, 'jti-10', own);
    m.registerConnection(20, 'jti-20', otherTenant);
    m.registerConnection(1, 'jti-1', platformSuper);
    m.removeConnection(own, 'client-close');
    m.removeConnection(otherTenant, 'client-close');
    m.removeConnection(platformSuper, 'force-logout');

    state.scope = 1;
    state.platformAdmin = false;
    const metrics = await service.getWsMetrics();
    expect(metrics.connections).toEqual([]);
    expect(metrics.recentDisconnects.map((d) => d.userId)).toEqual([10]);
    expect(metrics.currentConnections).toBe(0);
  });

  it('消息采样与 Topic 聚合按可见用户重算，累计计数器保持平台级', async () => {
    const own = fakeWs();
    const otherTenant = fakeWs();
    m.registerConnection(10, 'jti-10', own);
    m.registerConnection(20, 'jti-20', otherTenant);
    m.incWsRecv(own, JSON.stringify({ type: 'chat:message' }));
    m.incWsRecv(otherTenant, JSON.stringify({ type: 'payment:paid' }));

    state.scope = 1;
    state.platformAdmin = false;
    const metrics = await service.getWsMetrics();
    expect(metrics.messages.map((x) => x.userId)).toEqual([10]);
    expect(metrics.topics.map((t) => t.topic)).toEqual(['chat']);
    // 累计计数器无按用户历史，仍为平台级：契约上已标注该口径
    expect(metrics.totalConnects).toBe(2);
    expect(metrics.totalRecv).toBe(2);
  });
});
