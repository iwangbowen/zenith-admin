/** Request scope and SQL shape tests; the database transport is replaced, SQL compilation is real. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect, QueryBuilder } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { JwtPayload } from '../../middleware/auth';

const state = vi.hoisted(() => ({
  config: { multiTenantMode: true },
  actor: { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null } as JwtPayload,
  select: vi.fn(), count: vi.fn(),
}));
vi.mock('../../config', () => ({ config: state.config }));
vi.mock('../../db', () => ({ db: { select: state.select, $count: state.count } }));
vi.mock('../../lib/context', () => ({ currentUser: () => state.actor }));

import { apiAccessLogs } from '../../db/schema';
import { apiAccessLogListQuery } from '@zenith/shared/platform';
import { apiAccessLogSummaryColumns, assertApiAccessLogScope, buildApiAccessLogsWhere, getApiAccessLog, listApiAccessLogs } from './api-access-logs.service';

const dialect = new PgDialect({ casing: 'snake_case' });
const queryBuilder = new QueryBuilder(dialect);
const render = (condition: SQL | undefined) => condition ? dialect.sqlToQuery(condition) : { sql: '', params: [] };
const platform: JwtPayload = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null };
const tenantAdmin: JwtPayload = { userId: 9, username: 'tenant-admin', roles: ['super_admin'], tenantId: 7 };

function selection(rows: Array<Record<string, unknown>>) {
  const chain = {
    from: vi.fn((_table: unknown) => chain), where: vi.fn((_condition?: SQL) => chain), orderBy: vi.fn((..._order: unknown[]) => chain),
    $dynamic: vi.fn(() => chain), limit: vi.fn((_limit: number) => chain), offset: vi.fn((_offset: number) => chain),
    then: <T>(resolve: (value: Array<Record<string, unknown>>) => T) => Promise.resolve(rows).then(resolve),
  };
  state.select.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.config.multiTenantMode = true;
  state.actor = { ...platform };
  state.count.mockResolvedValue(0);
});

describe('API access log visibility', () => {
  it('rejects tenant super admins and unprivileged platform actors before querying', async () => {
    for (const user of [tenantAdmin, { ...platform, roles: ['admin'] }]) {
      state.actor = user;
      expect(() => assertApiAccessLogScope(user)).toThrow('仅平台管理员');
      await expect(listApiAccessLogs({ page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 403 });
      await expect(getApiAccessLog(42)).rejects.toMatchObject({ status: 403 });
    }
    expect(state.select).not.toHaveBeenCalled();
    expect(state.count).not.toHaveBeenCalled();
  });

  it('keeps platform tenant-view filtering in list and detail', async () => {
    state.actor = { ...platform, viewingTenantId: 7 };
    expect(render(buildApiAccessLogsWhere({}))).toMatchObject({ params: [7] });
    const chain = selection([]);
    await expect(getApiAccessLog(42)).rejects.toMatchObject({ status: 404 });
    const compiled = render(chain.where.mock.calls[0][0]);
    expect(compiled.sql).toContain('"tenant_id" =');
    expect(compiled.params).toEqual([42, 7]);
  });

  it('platform view is unfiltered, single-tenant scope remains permission-controlled by the route', () => {
    expect(buildApiAccessLogsWhere({})).toBeUndefined();
    state.config.multiTenantMode = false;
    state.actor = tenantAdmin;
    expect(buildApiAccessLogsWhere({})).toBeUndefined();
  });
});

describe('API access log filtering and projection', () => {
  it('keeps identity, HTTP result, duration and service filters parameterized', () => {
    const compiled = render(buildApiAccessLogsWhere({ accessorId: 'app:test', deviceId: 13, userId: 11, memberId: 12, clientId: 'app1', accessorType: 'open_application', credentialType: 'open_signature', responseCode: 503, status: 'fail', method: 'post', minDurationMs: 100, maxDurationMs: 2500, serviceName: 'api', ip: '192.168.' }));
    for (const column of ['accessor_id', 'user_id', 'member_id', 'device_id', 'client_id', 'accessor_type', 'credential_type', 'response_code', 'method', 'duration_ms', 'service_name', 'ip']) {
      expect(compiled.sql).toContain(`"${column}"`);
    }
    expect(compiled.params).toEqual([11, 12, 13, '%app:test%', '%app1%', 'open_application', 'open_signature', 'POST', '%api%', '%192.168.%', 503, 400, 100, 2500]);
    expect(compiled.sql).not.toContain('192.168.');
  });

  it('escapes LIKE wildcards for path/content and prefixes request IDs', () => {
    const compiled = render(buildApiAccessLogsWhere({ path: '/api/100%_x', requestId: 'req_7', content: '50%_\\' }));
    expect(compiled.sql).toContain('"query_params"::text ilike');
    expect(compiled.sql).toContain('"request_body"::text ilike');
    expect(compiled.params).toEqual(['%/api/100\\%\\_x%', 'req\\_7%', '%50\\%\\_\\\\%', '%50\\%\\_\\\\%']);
  });

  it('keeps success status and date bounds inclusive through the entire end date', () => {
    const compiled = render(buildApiAccessLogsWhere({ status: 'success', startTime: '2026-11-01', endTime: '2026-11-03' }));
    expect(compiled.sql).toContain('"response_code" >=');
    expect(compiled.sql).toContain('"response_code" <=');
    expect(compiled.sql).toContain('"created_at" >=');
    expect(compiled.sql).toContain('"created_at" <=');
    expect(compiled.params.slice(0, 2)).toEqual([200, 399]);
    const [start, end] = compiled.params.slice(2).map((value) => new Date(String(value)).getTime());
    expect(end - start).toBe(3 * 86_400_000 - 1);
  });

  it('list requests select only the summary SQL projection and retain stable pagination', async () => {
    const chain = selection([]);
    const q = apiAccessLogListQuery.parse({ page: 2, pageSize: 20, path: '/api/orders' });
    await expect(listApiAccessLogs(q)).resolves.toMatchObject({ list: [], total: 0, page: 2, pageSize: 20 });
    expect(state.select).toHaveBeenCalledWith(apiAccessLogSummaryColumns);
    expect(chain.limit).toHaveBeenCalledWith(20);
    expect(chain.offset).toHaveBeenCalledWith(20);
    expect(render(state.count.mock.calls[0][1])).toEqual(render(chain.where.mock.calls[0][0]));
    const generated = queryBuilder.select(apiAccessLogSummaryColumns).from(apiAccessLogs).toSQL().sql;
    for (const column of ['query_params', 'request_body', 'user_agent', 'error_message']) expect(generated).not.toContain(`"${column}"`);
    expect(generated).toContain('"request_id"');
    expect(generated).toContain('"response_code"');
  });

  it('returns a 404 for a missing or out-of-scope detail', async () => {
    const chain = selection([]);
    await expect(getApiAccessLog(987)).rejects.toMatchObject({ status: 404 });
    expect(render(chain.where.mock.calls[0][0]).params).toEqual([987]);
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  it('projects detail through the contract and formats its timestamp', async () => {
    selection([{ id: 42, tenantId: null, accessorId: 'user:1', userId: 1, memberId: null, deviceId: null, clientId: null, accessorName: 'admin', accessorType: 'admin_user', credentialType: 'admin_session', method: 'POST', path: '/api/orders', routePath: '/api/orders', requestId: 'req-42', responseCode: 400, durationMs: 12, requestBody: { password: '***', title: '采购' }, queryParams: {}, createdAt: new Date('2026-11-03T08:00:00Z'), internalCredential: 'must-not-leak' }]);
    const detail = await getApiAccessLog(42);
    expect(detail).toMatchObject({ id: 42, requestId: 'req-42', requestBody: { password: '***', title: '采购' }, queryParams: {}, responseCode: 400 });
    expect(detail.createdAt).toMatch(/^2026-11-03 \d{2}:00:00$/);
    expect(detail).not.toHaveProperty('internalCredential');
    expect(detail.impersonatorId).toBeNull();
  });
});
