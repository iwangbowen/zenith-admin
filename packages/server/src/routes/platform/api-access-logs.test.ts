import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono, type Context, type Next } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { apiAccessLogContract } from '@zenith/shared/platform';
import type { JwtPayload } from '../../middleware/auth';

const state = vi.hoisted(() => ({
  user: { userId: 1, username: 'admin', tenantId: null, roles: ['super_admin'] } as JwtPayload,
  permissions: ['system:api-access-log:clean'], multiTenant: true,
  clean: vi.fn(), before: vi.fn(), audit: vi.fn(),
}));
vi.mock('../../config', async original => ({
  config: { ...(await original<typeof import('../../config')>()).config, get multiTenantMode() { return state.multiTenant; } },
}));
vi.mock('../../db', () => {
  const executor = { insert: () => ({ values: state.audit }) };
  return { db: { ...executor, transaction: async (fn: (tx: typeof executor) => Promise<unknown>) => fn(executor) } };
});
// Bind only the test principal; production authorization, validation and audit stay real.
vi.mock('../../middleware/auth', () => ({ authMiddleware: async (c: Context, next: Next) => {
  if (!c.req.header('Authorization')) return c.json({ code: 401, message: '未登录' }, 401);
  c.set('user', state.user);
  await next();
} }));
vi.mock('../../lib/permissions', async original => ({
  ...await original<typeof import('../../lib/permissions')>(), getUserPermissions: async () => state.permissions,
}));
vi.mock('../../services/platform/api-access-logs.service', () => ({
  listApiAccessLogs: vi.fn(), getApiAccessLog: vi.fn(), cleanApiAccessLogs: state.clean, getCleanApiAccessLogsBeforeAudit: state.before,
}));

import router from './api-access-logs';

function request(query = '', authenticated = true) {
  const app = new Hono();
  app.use('*', contextStorage());
  app.route(apiAccessLogContract.basePath, router);
  return app.request(`${apiAccessLogContract.clean.fullPath}${query}`, { method: 'DELETE', headers: authenticated ? { Authorization: 'Bearer test-principal' } : {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { userId: 1, username: 'admin', tenantId: null, roles: ['super_admin'] };
  state.permissions = ['system:api-access-log:clean'];
  state.multiTenant = true;
  state.clean.mockResolvedValue(7);
  state.before.mockImplementation(async days => ({ days, total: 7 }));
  state.audit.mockReturnValue({ returning: async () => [{ id: 1 }] });
});

describe('API access log cleanup authorization and audit', () => {
  it('rejects unauthenticated requests before reading or deleting', async () => {
    expect((await request('?days=0', false)).status).toBe(401);
    expect(state.clean).not.toHaveBeenCalled();
    expect(state.before).not.toHaveBeenCalled();
  });

  it('read and export permissions do not grant cleanup in single-tenant mode', async () => {
    state.multiTenant = false;
    state.user.roles = ['admin'];
    state.permissions = ['system:api-access-log:list', 'system:api-access-log:export'];
    expect((await request('?days=0')).status).toBe(403);
    expect(state.clean).not.toHaveBeenCalled();
    expect(state.before).not.toHaveBeenCalled();
  });

  it('rejects tenant super admins even with the cleanup permission', async () => {
    state.user.tenantId = 7;
    expect((await request('?days=0')).status).toBe(403);
    expect(state.clean).not.toHaveBeenCalled();
  });

  it.each(['', '%20', '-1', 'abc'])('invalid days %s never reaches the cleanup service', async days => {
    const response = await request(`?days=${days}`);
    expect(response.status).toBe(400);
    await response.json();
    expect(state.clean).not.toHaveBeenCalled();
    expect(state.before).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(state.audit).toHaveBeenCalledTimes(1));
  });

  it.each([['', 180], ['?days=0', 0], ['?days=30', 30]] as const)('returns actual count and records audit snapshots for %s', async (query, days) => {
    const response = await request(query);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: 0, data: { deleted: 7 } });
    expect(state.before).toHaveBeenCalledWith(days);
    expect(state.clean).toHaveBeenCalledWith(days);
    await vi.waitFor(() => expect(state.audit).toHaveBeenCalledTimes(1));
    const logged = state.audit.mock.calls[0][0];
    expect(JSON.parse(logged.beforeData)).toEqual({ days, total: 7 });
    expect(JSON.parse(logged.afterData)).toEqual({ days, deleted: 7 });
  });

  it('allows a single-tenant operator with the cleanup permission', async () => {
    state.multiTenant = false;
    state.user.roles = ['admin'];
    expect((await request('?days=365')).status).toBe(200);
    expect(state.clean).toHaveBeenCalledWith(365);
  });
});
