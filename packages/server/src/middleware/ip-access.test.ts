/**
 * IP 访问控制中间件单测（黑/白名单，访问层安全关键）。
 *
 * 覆盖要点：
 *  1. 免检路径（登录/验证码/OAuth）直接放行
 *  2. 黑白名单均未启用 → 快速路径放行
 *  3. 黑名单命中（单 IP / CIDR 段）→ 403 + 写拦截日志
 *  4. 白名单启用且 IP 不在名单 → 403；在名单（CIDR）→ 放行
 *  5. 黑名单优先于白名单
 *  6. 配置 JSON 损坏 → 空名单兜底（不误伤）
 *  7. 30s 配置缓存与 invalidateIpAccessCache 失效
 *
 * Mock 策略：system-config / ip-access-logs.service / request-helpers mock。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../lib/system-config', () => ({
  getConfigBoolean: vi.fn().mockResolvedValue(false),
  getConfigValue: vi.fn().mockResolvedValue('[]'),
}));

vi.mock('../services/platform/ip-access-logs.service', () => ({
  writeIpAccessLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/request-helpers', () => ({
  getClientIp: vi.fn().mockReturnValue('203.0.113.10'),
}));

import { getConfigBoolean, getConfigValue } from '../lib/system-config';
import { writeIpAccessLog } from '../services/platform/ip-access-logs.service';
import { getClientIp } from '../lib/request-helpers';
import { ipAccessMiddleware, invalidateIpAccessCache } from './ip-access';

const boolMock = vi.mocked(getConfigBoolean);
const valueMock = vi.mocked(getConfigValue);
const logMock = vi.mocked(writeIpAccessLog);
const ipMock = vi.mocked(getClientIp);

function buildApp() {
  const app = new Hono();
  app.use('*', ipAccessMiddleware);
  app.all('*', (c) => c.json({ code: 0, message: 'success', data: null }));
  return app;
}

/** 配置四项 system-config：白名单开关、白名单、黑名单开关、黑名单 */
function mockConfig(opts: { wlEnabled?: boolean; wl?: string[]; blEnabled?: boolean; bl?: string[]; wlRaw?: string; blRaw?: string }) {
  boolMock.mockImplementation(async (key: string) => {
    if (key === 'ip_whitelist_enabled') return opts.wlEnabled ?? false;
    if (key === 'ip_blacklist_enabled') return opts.blEnabled ?? false;
    return false;
  });
  valueMock.mockImplementation(async (key: string) => {
    if (key === 'ip_whitelist') return opts.wlRaw ?? JSON.stringify(opts.wl ?? []);
    if (key === 'ip_blacklist') return opts.blRaw ?? JSON.stringify(opts.bl ?? []);
    return '[]';
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateIpAccessCache(); // 每个用例重新加载配置
  ipMock.mockReturnValue('203.0.113.10');
  mockConfig({});
});

describe('ipAccessMiddleware - 免检路径', () => {
  it.each(['/api/auth/login', '/api/auth/captcha', '/api/auth/refresh'])('免检路径 %s 直接放行（不读配置）', async (path) => {
    const res = await buildApp().request(path);
    expect(res.status).toBe(200);
    expect(boolMock).not.toHaveBeenCalled();
  });

  it('OAuth 前缀路径放行', async () => {
    const res = await buildApp().request('/api/oauth/github/callback');
    expect(res.status).toBe(200);
    expect(boolMock).not.toHaveBeenCalled();
  });
});

describe('ipAccessMiddleware - 开关关闭', () => {
  it('黑白名单均未启用 → 放行且不解析 IP', async () => {
    const res = await buildApp().request('/api/users');
    expect(res.status).toBe(200);
    expect(ipMock).not.toHaveBeenCalled();
  });
});

describe('ipAccessMiddleware - 黑名单', () => {
  it('黑名单命中单 IP → 403 并写拦截日志', async () => {
    mockConfig({ blEnabled: true, bl: ['203.0.113.10'] });
    const res = await buildApp().request('/api/users');
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ code: 403, message: '您的IP已被禁止访问', data: null });
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '203.0.113.10', path: '/api/users', blockType: 'blacklist' }),
    );
  });

  it('黑名单 CIDR 段命中 → 403', async () => {
    mockConfig({ blEnabled: true, bl: ['203.0.113.0/24'] });
    const res = await buildApp().request('/api/users');
    expect(res.status).toBe(403);
  });

  it('黑名单未命中 → 放行', async () => {
    mockConfig({ blEnabled: true, bl: ['198.51.100.1'] });
    const res = await buildApp().request('/api/users');
    expect(res.status).toBe(200);
    expect(logMock).not.toHaveBeenCalled();
  });
});

describe('ipAccessMiddleware - 白名单', () => {
  it('白名单启用且 IP 不在名单 → 403 拦截', async () => {
    mockConfig({ wlEnabled: true, wl: ['10.0.0.0/8'] });
    const res = await buildApp().request('/api/users');
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.message).toBe('您的IP不在允许访问范围内');
    expect(logMock).toHaveBeenCalledWith(expect.objectContaining({ blockType: 'whitelist' }));
  });

  it('白名单 CIDR 命中 → 放行', async () => {
    mockConfig({ wlEnabled: true, wl: ['203.0.113.0/24'] });
    const res = await buildApp().request('/api/users');
    expect(res.status).toBe(200);
  });

  it('黑名单优先于白名单（同时命中先拒于黑名单）', async () => {
    mockConfig({ wlEnabled: true, wl: ['203.0.113.10'], blEnabled: true, bl: ['203.0.113.10'] });
    const res = await buildApp().request('/api/users');
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.message).toBe('您的IP已被禁止访问');
  });
});

describe('ipAccessMiddleware - 配置容错与缓存', () => {
  it('名单 JSON 损坏 → 按空名单兜底放行（不误伤全站）', async () => {
    mockConfig({ blEnabled: true, blRaw: 'not-valid-json' });
    const res = await buildApp().request('/api/users');
    expect(res.status).toBe(200);
  });

  it('30s 内配置命中缓存（第二次请求不再读配置）', async () => {
    mockConfig({ blEnabled: true, bl: ['198.51.100.1'] });
    const app = buildApp();
    await app.request('/api/users');
    const loads = boolMock.mock.calls.length;
    await app.request('/api/users');
    expect(boolMock.mock.calls.length).toBe(loads); // 未增加
  });

  it('invalidateIpAccessCache 后重新加载配置', async () => {
    mockConfig({ blEnabled: true, bl: ['198.51.100.1'] });
    const app = buildApp();
    await app.request('/api/users');
    const loads = boolMock.mock.calls.length;

    invalidateIpAccessCache();
    mockConfig({ blEnabled: true, bl: ['203.0.113.10'] }); // 新配置封禁当前 IP
    const res = await app.request('/api/users');

    expect(boolMock.mock.calls.length).toBeGreaterThan(loads);
    expect(res.status).toBe(403);
  });
});
