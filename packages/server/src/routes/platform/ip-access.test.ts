import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono, type Context, type Next } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { ipAccessContract, ipAccessLogContract } from '@zenith/shared/platform';
import type { JwtPayload } from '../../middleware/auth';
const state = vi.hoisted(() => ({ user: { userId: 7, username: 'tenant', tenantId: 3, roles: ['tenant_admin'] } as JwtPayload,
  permissions: ['system:ip-access:view', 'system:ip-access:log'], multiTenant: true, diagnose: vi.fn(), logs: vi.fn() }));
vi.mock('../../config', async (original) => ({ config: { ...(await original<typeof import('../../config')>()).config, get multiTenantMode() { return state.multiTenant; } } }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: async (c: Context, next: Next) => {
  if (!c.req.header('Authorization')) return c.json({ code: 401, message: '未登录' }, 401);
  c.set('user', state.user); await next();
} }));
vi.mock('../../lib/permissions', async (original) => ({ ...await original<typeof import('../../lib/permissions')>(), getUserPermissions: async () => state.permissions }));
vi.mock('../../services/platform/ip-access.service', () => ({ diagnoseIpAccess: state.diagnose, getIpAccessContext: state.diagnose }));
vi.mock('../../services/platform/ip-access-logs.service', () => ({ listIpAccessLogs: state.logs, ipAccessLogStats: () => ({ accepted: 0, stored: 0, dropped: 0, flushFailures: 0, pending: 0, flushing: false }) }));
import router from './ip-access';
import logRouter from './ip-access-logs';
function app() { const a = new Hono(); a.use('*', contextStorage()); a.route(ipAccessContract.basePath, router); a.route(ipAccessLogContract.basePath, logRouter); return a; }
beforeEach(() => { vi.clearAllMocks(); state.multiTenant = true; state.user.tenantId = 3; state.user.roles = ['tenant_admin']; state.permissions = ['system:ip-access:view', 'system:ip-access:log']; });
describe('IP access platform boundary', () => {
  it('rejects a tenant with matching permissions before querying global data', async () => {
    const a = app();
    for (const path of [ipAccessContract.context.fullPath, ipAccessContract.logHealth.fullPath, ipAccessLogContract.list.fullPath]) {
      expect((await a.request(path, { headers: { Authorization: 'Bearer test' } })).status).toBe(403);
    }
    expect(state.logs).not.toHaveBeenCalled(); expect(state.diagnose).not.toHaveBeenCalled();
  });
  it('requires authentication and permission in single-tenant mode', async () => {
    const a = app(); state.multiTenant = false; state.permissions = [];
    expect((await a.request(ipAccessContract.context.fullPath)).status).toBe(401);
    expect((await a.request(ipAccessContract.context.fullPath, { headers: { Authorization: 'Bearer test' } })).status).toBe(403);
  });
});
