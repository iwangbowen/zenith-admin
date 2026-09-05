/**
 * IP 访问控制中间件单测（黑/白名单，访问层安全关键）。
 *
 * 覆盖要点：
 *  1. 免检路径（登录/验证码/OAuth）直接放行
 *  2. 黑白名单均未启用 → 快速路径放行
 *  3. 黑名单命中（单 IP / CIDR 段）→ 403 + 写拦截日志
 *  4. 白名单启用且 IP 不在名单 → 403；在名单（CIDR）→ 放行
 *  5. 黑名单优先于白名单
 *
 * 配置来自运行时设置 `ipAccess` 模块（lib/settings），缓存、失效与容错由该层负责并单独测试，这里只 mock 读取结果。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { IpAccessSettings } from '@zenith/shared/settings';

vi.mock('../lib/settings', () => ({
  getSettings: vi.fn(),
}));

vi.mock('../services/platform/ip-access-logs.service', () => ({
  writeIpAccessLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/request-helpers', () => ({
  getClientIp: vi.fn().mockReturnValue('203.0.113.10'),
}));

import { getSettings } from '../lib/settings';
import { writeIpAccessLog } from '../services/platform/ip-access-logs.service';
import { getClientIp } from '../lib/request-helpers';
import { ipAccessMiddleware } from './ip-access';

const settingsMock = vi.mocked(getSettings);
const logMock = vi.mocked(writeIpAccessLog);
const ipMock = vi.mocked(getClientIp);

function buildApp() {
  const app = new Hono();
  app.use('*', ipAccessMiddleware);
  app.all('*', (c) => c.json({ code: 0, message: 'success', data: null }));
  return app;
}

function mockConfig(opts: Partial<IpAccessSettings>) {
  const cfg: IpAccessSettings = {
    whitelistEnabled: false, whitelist: [], blacklistEnabled: false, blacklist: [], ...opts,
  };
  settingsMock.mockResolvedValue(cfg as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  ipMock.mockReturnValue('203.0.113.10');
  mockConfig({});
});

describe('ipAccessMiddleware - 免检路径', () => {
  it.each(['/api/auth/login', '/api/auth/captcha', '/api/auth/refresh'])('免检路径 %s 直接放行（不读配置）', async (path) => {
    const res = await buildApp().request(path);
    expect(res.status).toBe(200);
    expect(settingsMock).not.toHaveBeenCalled();
  });

  it('OAuth 前缀路径放行', async () => {
    const res = await buildApp().request('/api/oauth/github/callback');
    expect(res.status).toBe(200);
    expect(settingsMock).not.toHaveBeenCalled();
  });
});

describe('ipAccessMiddleware - 开关关闭', () => {
  it('黑白名单均未启用 → 放行且不解析 IP', async () => {
    const res = await buildApp().request('/api/users');
    expect(res.status).toBe(200);
    expect(settingsMock).toHaveBeenCalledWith('ipAccess');
    expect(ipMock).not.toHaveBeenCalled();
  });
});

describe('ipAccessMiddleware - 黑名单', () => {
  it('黑名单命中单 IP → 403 并写拦截日志', async () => {
    mockConfig({ blacklistEnabled: true, blacklist: ['203.0.113.10'] });
    const res = await buildApp().request('/api/users');
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ code: 403, message: '您的IP已被禁止访问', data: null });
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '203.0.113.10', path: '/api/users', blockType: 'blacklist' }),
    );
  });

  it('黑名单 CIDR 段命中 → 403', async () => {
    mockConfig({ blacklistEnabled: true, blacklist: ['203.0.113.0/24'] });
    const res = await buildApp().request('/api/users');
    expect(res.status).toBe(403);
  });

  it('黑名单未命中 → 放行', async () => {
    mockConfig({ blacklistEnabled: true, blacklist: ['198.51.100.1'] });
    const res = await buildApp().request('/api/users');
    expect(res.status).toBe(200);
    expect(logMock).not.toHaveBeenCalled();
  });
});

describe('ipAccessMiddleware - 白名单', () => {
  it('白名单启用且 IP 不在名单 → 403 拦截', async () => {
    mockConfig({ whitelistEnabled: true, whitelist: ['10.0.0.0/8'] });
    const res = await buildApp().request('/api/users');
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.message).toBe('您的IP不在允许访问范围内');
    expect(logMock).toHaveBeenCalledWith(expect.objectContaining({ blockType: 'whitelist' }));
  });

  it('白名单 CIDR 命中 → 放行', async () => {
    mockConfig({ whitelistEnabled: true, whitelist: ['203.0.113.0/24'] });
    const res = await buildApp().request('/api/users');
    expect(res.status).toBe(200);
  });

  it('黑名单优先于白名单（同时命中先拒于黑名单）', async () => {
    mockConfig({ whitelistEnabled: true, whitelist: ['203.0.113.10'], blacklistEnabled: true, blacklist: ['203.0.113.10'] });
    const res = await buildApp().request('/api/users');
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.message).toBe('您的IP已被禁止访问');
  });
});