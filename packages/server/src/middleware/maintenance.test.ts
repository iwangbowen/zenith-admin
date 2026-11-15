import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
const state = vi.hoisted(() => ({ enabled: true, fail: false, manage: false, bypass: false }));
vi.mock('../services/ops/maintenance.service', () => ({ getMaintenanceStatus: async () => {
  if (state.fail) throw new Error('unavailable');
  return { enabled: state.enabled, message: '升级', version: 4, estimatedEndAt: null, startedAt: '2026-11-15 00:00:00' };
} }));
vi.mock('./auth', () => ({ authenticateAdminRequest: async (c: { req: { header: (key: string) => string } }) => {
  if (!c.req.header('Authorization')) throw new Error('not authenticated'); return { userId: 1 };
} }));
vi.mock('../lib/maintenance-access', () => ({ maintenanceAccess: async () => ({ canManage: state.manage, canView: state.manage, canViewLogs: state.manage, canBypass: state.bypass }) }));
import { maintenanceMiddleware } from './maintenance';
function app() { const a = new Hono(); a.use('*', maintenanceMiddleware); a.all('*', (c) => c.text('business')); return a; }
beforeEach(() => { state.enabled = true; state.fail = false; state.manage = false; state.bypass = false; });
describe('maintenance enforcement', () => {
  it('blocks business and never confuses read failures with planned maintenance', async () => {
    const blocked = await app().request('/api/users');
    expect(blocked.status).toBe(503); expect(blocked.headers.get('X-Zenith-Error')).toBe('maintenance');
    expect(blocked.headers.get('Retry-After')).toBe('60');
    state.fail = true;
    expect((await app().request('/api/users')).headers.get('X-Zenith-Error')).toBe('maintenance-unavailable');
  });
  it('uses method-aware complete exceptions rather than raw prefixes', async () => {
    for (const path of ['/api/settings/public', '/api/auth/captcha', '/api/maintenance/status']) expect((await app().request(path)).status).toBe(200);
    for (const path of ['/api/auth/profile', '/api/ws-other', '/api/maintenance/status-evil']) expect((await app().request(path)).status).toBe(503);
    expect((await app().request('/api/public/payment/notify/wechat/token', { method: 'POST' })).status).toBe(200);
    expect((await app().request('/api/public/payment/notify/wechat/token')).status).toBe(503);
  });
  it('lets managers recover without granting business passage', async () => {
    state.manage = true; const headers = { Authorization: 'Bearer test' };
    expect((await app().request('/api/maintenance', { headers })).status).toBe(200);
    expect((await app().request('/api/menus/user', { headers })).status).toBe(200);
    expect((await app().request('/api/users', { headers })).status).toBe(503);
    state.bypass = true;
    expect((await app().request('/api/users', { headers })).status).toBe(200);
  });
});
