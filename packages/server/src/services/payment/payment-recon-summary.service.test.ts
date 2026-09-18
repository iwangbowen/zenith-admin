import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tenantId: 7 as number | null,
  roles: [] as string[],
  viewingTenantId: undefined as number | null | undefined,
  queries: [] as { sql: string; params: unknown[] }[],
  runGroups: [] as [status: string, count: number, changedAt: string][],
}));

vi.mock('../../config', async (original) => {
  const actual = await original<typeof import('../../config')>();
  return { ...actual, config: { ...actual.config, multiTenantMode: true } };
});
vi.mock('../../lib/context', () => ({
  currentUser: () => ({ userId: 11, tenantId: state.tenantId, roles: state.roles, viewingTenantId: state.viewingTenantId }),
}));
vi.mock('../../db', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy');
  // Compile the real query builder without opening a database connection. Only
  // transport results are stubbed, so tenant/account and owner filters are real.
  const db = drizzle(async (sql, params, method) => {
    state.queries.push({ sql, params });
    if (sql.includes('from "payment_recon_runs"')) return { rows: state.runGroups };
    return { rows: method === 'execute' ? [{ count: 0 }] : [] };
  }, { casing: 'snake_case' });
  return { db, readSnapshot: async (work: (executor: typeof db) => unknown) => work(db) };
});

import { getReconSummary } from './payment-recon.service';

const stamp = '2026-09-18 10:00:00.123456+08';
function runQuery() {
  const query = state.queries.find((entry) => entry.sql.includes('from "payment_recon_runs"'));
  expect(query).toBeDefined();
  return query!;
}

beforeEach(() => {
  state.tenantId = 7;
  state.roles = [];
  state.viewingTenantId = undefined;
  state.queries = [];
  state.runGroups = [];
});

describe('reconciliation summary run monitoring', () => {
  it('returns a stable empty revision with no active reconciliation runs', async () => {
    expect(await getReconSummary({})).toMatchObject({ activeRuns: 0, runRevision: '' });
  });

  it('counts pending and running work across all pages, including system-owned runs', async () => {
    state.runGroups = [['pending', 2, stamp], ['running', 3, stamp], ['completed', 400, stamp], ['failed', 5, stamp]];
    expect(await getReconSummary({})).toMatchObject({ activeRuns: 5 });
    const { sql } = runQuery();
    expect(sql).not.toMatch(/created_by|task_id|current_statement_id|\blimit\b|\boffset\b/);
    expect(sql.slice(sql.indexOf(' where '), sql.indexOf(' group by '))).not.toContain('"status"');
    expect(sql).toContain('order by "payment_recon_runs"."status" asc');
  });

  it('changes the revision for a system run that starts and finishes between idle polls', async () => {
    state.runGroups = [['completed', 200, stamp]];
    const before = await getReconSummary({});
    // The completion may share a timestamp with an existing run; the count must
    // still make it observable even though neither poll sees an active task.
    state.runGroups = [['completed', 201, stamp]];
    const after = await getReconSummary({});
    expect(before.activeRuns).toBe(0);
    expect(after.activeRuns).toBe(0);
    expect(after.runRevision).not.toBe(before.runRevision);
    expect((await getReconSummary({})).runRevision).toBe(after.runRevision);
  });

  it('observes a retry failure even if status counts do not change', async () => {
    state.runGroups = [['failed', 1, stamp]];
    const before = await getReconSummary({});
    state.runGroups = [['failed', 1, '2026-09-18 10:01:00.123456+08']];
    expect((await getReconSummary({})).runRevision).not.toBe(before.runRevision);
  });

  it('scopes account monitoring to both the current tenant and the parent period', async () => {
    await getReconSummary({ accountId: 23 });
    const { sql, params } = runQuery();
    expect(sql).toContain('"payment_statement_periods"."tenant_id" = $1');
    expect(sql).toContain('"payment_statement_periods"."account_id" = $2');
    expect(sql).toContain('"payment_recon_runs"."tenant_id" = $3');
    expect(params).toEqual([7, 23, 7]);
    expect(sql).toContain('"payment_statements"."id" = "payment_recon_runs"."statement_id"');
    expect(sql).toContain('"payment_statement_periods"."id" = "payment_statements"."period_id"');
  });

  it('uses a platform administrator\'s selected tenant rather than the platform scope', async () => {
    state.tenantId = null;
    state.roles = ['super_admin'];
    state.viewingTenantId = 19;
    await getReconSummary({ accountId: 23 });
    expect(runQuery().params).toEqual([19, 23, 19]);
  });

  it('keeps account filtering in the platform all-tenant view', async () => {
    state.tenantId = null;
    state.roles = ['super_admin'];
    await getReconSummary({ accountId: 23 });
    const { sql, params } = runQuery();
    expect(params).toEqual([23]);
    expect(sql).toContain('"payment_statement_periods"."account_id" = $1');
    expect(sql).not.toContain('"tenant_id"');
  });

  it('restricts tenant-less users to tenant-less periods and runs', async () => {
    state.tenantId = null;
    await getReconSummary({});
    const { sql, params } = runQuery();
    expect(params).toEqual([]);
    expect(sql).toContain('"payment_statement_periods"."tenant_id" is null');
    expect(sql).toContain('"payment_recon_runs"."tenant_id" is null');
  });
});
