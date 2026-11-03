/** Verify export scope and compiled cursor predicates without a live PostgreSQL transport. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { JwtPayload } from '../../../middleware/auth';
import type { ExportRuntimeContext } from '../types';

const state = vi.hoisted(() => ({
  config: { multiTenantMode: true },
  actor: { userId: 99, username: 'tenant-admin', roles: ['super_admin'], tenantId: 7 } as JwtPayload,
  select: vi.fn(), count: vi.fn(),
}));
vi.mock('../../../config', () => ({ config: state.config }));
vi.mock('../../../db', () => ({ db: { select: state.select, $count: state.count } }));
vi.mock('../../../lib/context', () => ({ currentUser: () => state.actor }));

import { apiAccessLogs } from '../../../db/schema';
import { buildApiAccessLogsWhere, apiAccessLogSummaryColumns } from '../../../services/platform/api-access-logs.service';
import { apiAccessLogsExportDefinition as definition } from './api-access-logs';

const dialect = new PgDialect({ casing: 'snake_case' });
const render = (condition: SQL | undefined) => condition ? dialect.sqlToQuery(condition) : { sql: '', params: [] };
const platform: JwtPayload = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null };

function context(query: Record<string, unknown>, user: JwtPayload): ExportRuntimeContext {
  return { jobId: 1, entity: definition.entity, moduleName: definition.moduleName, format: 'xlsx', query, selectedColumns: null, raw: false, masked: true, sensitive: false, watermark: false, currentUser: user, createdByName: user.username, exportedAt: new Date('2026-11-03T08:00:00Z') };
}

function selection(rows: Array<Record<string, unknown>>) {
  const chain = { from: vi.fn((_table: unknown) => chain), where: vi.fn((_condition?: SQL) => chain), orderBy: vi.fn((..._order: unknown[]) => chain), limit: vi.fn(async (_count: number) => rows) };
  state.select.mockReturnValueOnce(chain);
  return chain;
}

async function exportedRows(query: Record<string, unknown>, user = platform) {
  const rows: Record<string, unknown>[] = [];
  for await (const row of await definition.streamRows(query, user, context(query, user))) rows.push(row);
  return rows;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.config.multiTenantMode = true;
  state.actor = { userId: 99, username: 'tenant-admin', roles: ['super_admin'], tenantId: 7 };
  state.count.mockResolvedValue(0);
});

describe('API access log export authorization', () => {
  it('declares an independent export permission and rejects tenant actors even with that permission', async () => {
    expect(definition.permissions.export).toBe('system:api-access-log:export');
    await expect(definition.prepareQuery!({}, state.actor)).rejects.toMatchObject({ status: 403 });
    await expect(definition.countRows({}, state.actor)).rejects.toMatchObject({ status: 403 });
    await expect(exportedRows({}, state.actor)).rejects.toMatchObject({ status: 403 });
    expect(state.select).not.toHaveBeenCalled();
    expect(state.count).not.toHaveBeenCalled();
  });

  it('revalidates persisted filters and uses the supplied job actor rather than request ALS', async () => {
    const query = await definition.prepareQuery!({ userId: '11', memberId: '12', responseCode: '503', minDurationMs: '500', authType: 'signature', principalType: 'open-gateway', page: 90, unknown: 'drop' }, platform);
    expect(query).toMatchObject({ userId: 11, memberId: 12, responseCode: 503, minDurationMs: 500, authType: 'signature', principalType: 'open-gateway' });
    expect(query).not.toHaveProperty('page');
    expect(query).not.toHaveProperty('unknown');
    await expect(definition.countRows(query, platform)).resolves.toBe(0);
    expect(state.count).toHaveBeenCalledWith(apiAccessLogs, expect.anything());
    expect(render(state.count.mock.calls[0][1]).params).toEqual([11, 12, 'open-gateway', 'signature', 503, 500]);
  });

  it.each([{ responseCode: 999 }, { minDurationMs: -1 }, { authType: 'invented' }, { principalType: 'invented' }])('rejects invalid export filters %j', async (query) => {
    await expect(definition.prepareQuery!(query, platform)).rejects.toBeDefined();
    expect(state.count).not.toHaveBeenCalled();
  });
});

describe('API access log streaming', () => {
  it('shares all page filters and freezes the upper ID while advancing a strict cursor', async () => {
    const query = { path: '/api/orders', responseCode: 503, status: 'fail' as const, content: '采购%_测试', startTime: '2026-11-01', endTime: '2026-11-03' };
    const upper = selection([{ id: 6 }]);
    const first = selection([{ id: 6 }, { id: 5 }, { id: 4 }]);
    const second = selection([{ id: 3 }, { id: 2 }]);
    const empty = selection([]);
    await expect(exportedRows(query)).resolves.toEqual([{ id: 6 }, { id: 5 }, { id: 4 }, { id: 3 }, { id: 2 }]);

    const base = render(buildApiAccessLogsWhere(query, platform));
    expect(render(upper.where.mock.calls[0][0])).toEqual(base);
    const firstPredicate = render(first.where.mock.calls[0][0]);
    const secondPredicate = render(second.where.mock.calls[0][0]);
    const finalPredicate = render(empty.where.mock.calls[0][0]);
    expect(firstPredicate.params).toEqual([...base.params, 6]);
    expect(secondPredicate.params).toEqual([...base.params, 6, 4]);
    expect(finalPredicate.params).toEqual([...base.params, 6, 2]);
    expect(secondPredicate.sql).toMatch(/"id" <= \$\d+ and "api_access_logs"\."id" < \$\d+/);
    expect(first.limit).toHaveBeenCalledWith(1000);
    expect(state.select.mock.calls.slice(1).every(([projection]) => projection === apiAccessLogSummaryColumns)).toBe(true);
  });

  it('does not fetch any row pages when the filtered data set is empty', async () => {
    selection([]);
    await expect(exportedRows({ path: '/api/no-results' })).resolves.toEqual([]);
    expect(state.select).toHaveBeenCalledOnce();
  });

  it('limits exports to metadata columns and keeps generated file retention separate from source logs', () => {
    const keys = definition.columns.map((column) => column.key);
    for (const excluded of ['queryParams', 'requestBody', 'userAgent', 'errorMessage', 'beforeData', 'afterData', 'responseBody']) expect(keys).not.toContain(excluded);
    expect(definition.retention).toMatchObject({ normalDays: 7, sensitiveDays: 3, rawDays: 3 });
    expect(definition.execution).toMatchObject({ mode: 'auto', syncMaxRows: 5000 });
  });
});
