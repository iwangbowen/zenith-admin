/**
 * app-releases 路由挂载测试
 *
 * 应用版本管理拆为五个契约 / 五个路由器，共享 /api/app-releases 前缀并按 routes/ops/index.ts 的顺序挂载。
 * 本测试按同一顺序挂载，断言静态子路径不被含 /{id} 的路由遮蔽：
 *  1. GET /api/app-releases/stats?appId=1        → 200，且命中看板统计服务
 *  2. GET /api/app-releases/stats（缺 appId）     → 400，来自 stats 自身的 query 校验
 *  3. GET /api/app-releases/apps/all             → 200，不被 /apps/{id} 类路由吞掉
 *  4. GET /api/app-releases/releases/{id}        → 200，参数路由本身仍可达
 *
 * Mock 策略：auth / guard 直通，service 层全部 mock，只验证路由分发。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import {
  appArtifactContract,
  appReleaseContract,
  appReleaseStatsContract,
  clientAppContract,
  clientDeviceContract,
} from '@zenith/shared/ops';

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('../../middleware/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authMiddleware: async (c: any, next: () => Promise<void>) => {
    c.set('user', { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null });
    await next();
  },
}));

vi.mock('../../middleware/guard', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  guard: () => async (_c: any, next: () => Promise<void>) => next(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setAuditBeforeData: (_c: any, _data: unknown) => {},
}));

vi.mock('../../services/ops/app-releases.service', () => ({
  addExternalArtifact: vi.fn(),
  addFileArtifact: vi.fn(),
  createAppRelease: vi.fn(),
  createClientApp: vi.fn(),
  deleteAppArtifact: vi.fn(),
  deleteAppRelease: vi.fn(),
  deleteClientApp: vi.fn(),
  getAppArtifactBeforeAudit: vi.fn(),
  getAppRelease: vi.fn(),
  getAppReleaseBeforeAudit: vi.fn(),
  getAppReleaseStats: vi.fn(),
  getClientAppBeforeAudit: vi.fn(),
  listAllClientApps: vi.fn(),
  listAppReleases: vi.fn(),
  listClientApps: vi.fn(),
  publishAppRelease: vi.fn(),
  revokeAppRelease: vi.fn(),
  setAppReleaseRollout: vi.fn(),
  updateAppRelease: vi.fn(),
  updateClientApp: vi.fn(),
}));

vi.mock('../../services/ops/client-devices.service', () => ({
  adminUnbindDevicePush: vi.fn(),
  deleteClientDevice: vi.fn(),
  getClientDeviceBeforeAudit: vi.fn(),
  listClientDevices: vi.fn(),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
import { getAppRelease, getAppReleaseStats, listAllClientApps } from '../../services/ops/app-releases.service';
import {
  appArtifactsRouter,
  appReleaseStatsRouter,
  appReleasesRouter,
  clientAppsRouter,
  clientDevicesRouter,
} from './app-releases';

const statsMock = vi.mocked(getAppReleaseStats);
const detailMock = vi.mocked(getAppRelease);
const allAppsMock = vi.mocked(listAllClientApps);

const emptyStats = { totals: { checks: 0, downloads: 0, devices: 0, installSuccess: 0, installFail: 0 }, trend: [], platforms: [], versions: [] };

/** 与 routes/ops/index.ts 保持同一挂载顺序：静态子资源前缀先于 /api/app-releases 根 */
function buildApp() {
  const app = new Hono();
  app.use('*', contextStorage());
  app.route(clientAppContract.basePath, clientAppsRouter);
  app.route(appReleaseContract.basePath, appReleasesRouter);
  app.route(appArtifactContract.basePath, appArtifactsRouter);
  app.route(clientDeviceContract.basePath, clientDevicesRouter);
  app.route(appReleaseStatsContract.basePath, appReleaseStatsRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  statsMock.mockResolvedValue(emptyStats);
  allAppsMock.mockResolvedValue([]);
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('GET /api/app-releases/stats - 静态子路径不被参数路由遮蔽', () => {
  it('带 appId → 200 并调用看板统计服务（days 取默认 30）', async () => {
    const res = await buildApp().request('/api/app-releases/stats?appId=1');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.code).toBe(0);
    expect(body.data).toEqual(emptyStats);
    expect(statsMock).toHaveBeenCalledWith(1, 30);
  });

  it('缺 appId → 400，由 stats 自身的 query 校验返回', async () => {
    const res = await buildApp().request('/api/app-releases/stats');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe(400);
    expect(statsMock).not.toHaveBeenCalled();
    expect(detailMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/app-releases/apps/all - 静态子路径', () => {
  it('→ 200 返回启用应用列表', async () => {
    const res = await buildApp().request('/api/app-releases/apps/all');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(allAppsMock).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/app-releases/releases/{id} - 参数路由', () => {
  it('→ 200 返回版本详情', async () => {
    const release = {
      id: 12, appId: 1, channel: 'stable', version: '1.2.3', notes: null, status: 'draft', mandatory: false,
      minVersion: null, rolloutPercent: 100, publishedAt: null, createdAt: '2026-01-01 00:00:00', updatedAt: '2026-01-01 00:00:00',
    };
    detailMock.mockResolvedValue(release as never);

    const res = await buildApp().request('/api/app-releases/releases/12');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe(12);
    expect(detailMock).toHaveBeenCalledWith(12);
  });
});
