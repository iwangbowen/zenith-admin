import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { identitySecurityContract } from '@zenith/shared/identity';
import type { JwtPayload } from '../../middleware/auth';

const state = vi.hoisted(() => ({
  user: { userId: 10, username: 'tenant-admin', tenantId: 1, roles: ['user'] } as JwtPayload,
  permissions: ['system:login-risk:list'],
  multiTenant: true,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  rows: [] as unknown[][],
  count: 0,
}));

vi.mock('../../config', async (original) => {
  const actual = await original<typeof import('../../config')>();
  return { config: { ...actual.config, get multiTenantMode() { return state.multiTenant; } } };
});
vi.mock('../../db', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy');
  return { db: drizzle(async (sql, params) => {
    state.queries.push({ sql, params });
    return { rows: sql.startsWith('select count(') ? [{ count: state.count }] : state.rows };
  }, { casing: 'snake_case' }) };
});
// Authentication binds a fixed test principal; authorization, contract validation,
// service execution, and PostgreSQL query generation remain real.
vi.mock('../../middleware/auth', async () => {
  const { createMiddleware } = await import('hono/factory');
  const { errBody } = await import('../../lib/openapi-schemas');
  return { authMiddleware: createMiddleware(async (c, next) => {
    if (!c.req.header('Authorization')) return c.json(errBody('未登录', 401), 401);
    c.set('user', state.user);
    await next();
  }) };
});
vi.mock('../../lib/permissions', async (original) => ({
  ...await original<typeof import('../../lib/permissions')>(),
  getUserPermissions: vi.fn(async () => state.permissions),
}));

import router from './identity-security';

function request(query: Record<string, string> = {}, authenticated = true) {
  const app = new Hono();
  app.use('*', contextStorage());
  app.route(identitySecurityContract.basePath, router);
  return app.request(`${identitySecurityContract.riskEvents.fullPath}?${new URLSearchParams(query)}`, {
    headers: authenticated ? { Authorization: 'Bearer test-principal' } : {},
  });
}

beforeEach(() => {
  state.user = { userId: 10, username: 'tenant-admin', tenantId: 1, roles: ['user'] };
  state.permissions = ['system:login-risk:list'];
  state.multiTenant = true;
  state.queries.length = 0;
  state.rows = [];
  state.count = 0;
});

describe('login risk events authorization and tenant query boundary', () => {
  it('rejects unauthenticated callers before querying events', async () => {
    expect((await request({}, false)).status).toBe(401);
    expect(state.queries).toHaveLength(0);
  });

  it('does not treat policy management as permission to read risk events', async () => {
    state.permissions = ['system:identity-security:manage'];
    expect((await request()).status).toBe(403);
    expect(state.queries).toHaveLength(0);
  });

  it.each([
    ['tenant user', 1, ['user'], undefined, '"tenant_id" = $1', [1]],
    ['ordinary platform user', null, ['user'], undefined, '"tenant_id" is null', []],
    ['super-admin global view', null, ['super_admin'], undefined, null, []],
    ['super-admin explicit global view', null, ['super_admin'], null, null, []],
    ['super-admin tenant view', null, ['super_admin'], 2, '"tenant_id" = $1', [2]],
  ] as const)('%s applies the same scope to count and rows', async (_name, tenantId, roles, viewingTenantId, predicate, params) => {
    state.user = { ...state.user, tenantId, roles: [...roles], viewingTenantId };
    const response = await request();
    expect(response.status).toBe(200);
    expect(state.queries).toHaveLength(2);
    for (const query of state.queries) {
      if (predicate) expect(query.sql).toContain(predicate);
      else expect(query.sql).not.toContain(' where ');
      expect(query.params.slice(0, params.length)).toEqual(params);
    }
  });

  it('keeps the single-tenant mode semantics', async () => {
    state.multiTenant = false;
    expect((await request()).status).toBe(200);
    expect(state.queries.every(({ sql }) => !sql.includes(' where '))).toBe(true);
  });

  it('does not let a tenant super_admin code bypass the read permission', async () => {
    state.user.roles = ['super_admin'];
    state.permissions = [];
    expect((await request()).status).toBe(403);
    expect(state.queries).toHaveLength(0);
  });

  it('escapes literal wildcard search and scopes both queries before pagination', async () => {
    const response = await request({ keyword: '  B%_\\  ', page: '3', pageSize: '2', tenantId: '2' });
    expect(response.status).toBe(200);
    const count = state.queries.find(({ sql }) => sql.startsWith('select count('))!;
    const rows = state.queries.find(({ sql }) => !sql.startsWith('select count('))!;
    const countWhere = count.sql.slice(count.sql.indexOf(' where ')).replace(/;$/, '');
    const rowsWhere = rows.sql.slice(rows.sql.indexOf(' where '), rows.sql.indexOf(' order by '));
    expect(rowsWhere).toBe(countWhere);
    expect(count.params).toEqual([1, '%B\\%\\_\\\\%', '%B\\%\\_\\\\%', '%B\\%\\_\\\\%']);
    expect(rows.params).toEqual([...count.params, 2, 4]);
    expect(rows.sql).toContain('order by "login_risk_events"."created_at" desc, "login_risk_events"."id" desc');
    expect(rows.sql).not.toContain('device_id_hash');
  });

  it('returns the scoped count and maps only contract fields', async () => {
    state.count = 1;
    state.rows = [[5, 10, 'tenant-admin', 1, 'medium', 'new device', 'challenge', '192.0.2.1', null, 'test', '2026-09-08T00:00:00Z']];
    const response = await request();
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.total).toBe(1);
    expect(data.list).toHaveLength(1);
    expect(data.list[0]).toMatchObject({ id: 5, tenantId: 1, username: 'tenant-admin' });
    expect(data.list[0].createdAt).toEqual(expect.any(String));
    expect(data.list[0]).not.toHaveProperty('deviceIdHash');
  });

  it.each([['page', '0'], ['pageSize', '201']])('rejects invalid pagination %s=%s before SQL', async (key, value) => {
    expect((await request({ [key]: value })).status).toBe(400);
    expect(state.queries).toHaveLength(0);
  });
});
