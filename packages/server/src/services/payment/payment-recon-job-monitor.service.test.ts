import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createPgClient } from '../../db/client';
import { jobStuckItemSchema } from '@zenith/shared/platform';
const state = vi.hoisted(() => ({ queries: [] as { sql: string; params: unknown[] }[], snapshots: 0 }));
vi.mock('../../db', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy');
  const db = drizzle(async (sql, params) => {
    state.queries.push({ sql, params });
    if (sql.includes('from "payment_recon_runs"')) {
      if (sql.includes('"statement_id"')) return { rows: [[17, 8, 'running', '2026-10-03T07:00:00Z', '2026-10-03T07:00:00Z', '2026-10-03T07:30:00Z', null]] };
      return { rows: [[2, 1, 3, 1]] };
    }
    if (sql.includes('from "payment_statement_periods"')) return { rows: [['failed', 4], ['ready', 2]] };
    if (sql.includes('from "payment_recon_cases"')) return { rows: [['open', 5, 2], ['resolved', 9, 8]] };
    return { rows: [] };
  }, { casing: 'snake_case' });
  return { db, readSnapshot: async (work: (executor: typeof db) => unknown) => { state.snapshots++; return work(db); } };
});
import { getPaymentReconHealth, listStuckPaymentReconRuns, stuckPaymentReconRunCondition } from './payment-recon-job-monitor.service';
beforeEach(() => { state.queries = []; state.snapshots = 0; });

describe('payment reconciliation job monitor', () => {
  it('uses one snapshot and shared status counts for platform warnings without request scope', async () => {
    const result = await getPaymentReconHealth();
    expect(state.snapshots).toBe(1);
    expect(result.counts).toEqual({ pending: 0, running: 0, stuck: 2, dead: null, failed24h: 1, succeeded24h: 3 });
    expect(result.issues).toEqual([{ level: 'warn', message: expect.stringContaining('4 个') }, { level: 'warn', message: expect.stringContaining('2 个') }]);
    for (const table of ['payment_statement_periods', 'payment_recon_cases']) {
      const query = state.queries.find(entry => entry.sql.includes(`from "${table}"`));
      expect(query?.sql).not.toContain('"tenant_id"');
      expect(query?.sql).not.toContain('"account_id"');
    }
    expect(state.queries[0].sql).toContain('"finished_at" >=');
    expect(state.queries[0].params.some(value => value instanceof Date)).toBe(false);
  });
  it('projects stuck runs without frozen financial snapshots and limits the rows', async () => {
    const [item] = await listStuckPaymentReconRuns(11);
    expect(item).toMatchObject({ source: 'payment-recon', refId: '17', title: '账单 #8 / 对账 #17' });
    expect(jobStuckItemSchema.safeParse(item).success).toBe(true);
    expect(state.queries[0].params).toContain(11);
    expect(state.queries[0].sql).not.toContain('local_snapshot');
    expect(state.queries[0].sql).not.toContain('snapshot_context');
  });
});

describe.skipIf(process.env.RUN_JOB_MONITOR_DB_TESTS !== '1')('payment reconciliation condition on PostgreSQL fixtures', () => {
  it('detects orphan runs and sixty minute timeouts while preserving live queued work and startup grace', async () => {
    const now = new Date('2026-10-03T08:00:00Z');
    const old = new Date(now.getTime() - 7_200_000).toISOString();
    const recent = new Date(now.getTime() - 600_000).toISOString();
    const fresh = new Date(now.getTime() - 10_000).toISOString();
    const tasks = [
      { id: 1, status: 'running', heartbeat_at: fresh, updated_at: fresh },
      { id: 2, status: 'pending', heartbeat_at: null, updated_at: old },
      { id: 3, status: 'success', heartbeat_at: old, updated_at: old },
    ];
    const runs = [
      { id: 1, status: 'pending', task_id: 999, started_at: null, created_at: old },
      { id: 2, status: 'running', task_id: 1, started_at: old, created_at: old },
      { id: 3, status: 'running', task_id: 1, started_at: recent, created_at: old },
      { id: 4, status: 'running', task_id: 3, started_at: recent, created_at: old },
      { id: 5, status: 'pending', task_id: 2, started_at: null, created_at: old },
      { id: 6, status: 'pending', task_id: 999, started_at: null, created_at: fresh },
      { id: 7, status: 'completed', task_id: 999, started_at: old, created_at: old },
    ];
    const client = createPgClient(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zenith_admin', { max: 1, onnotice: () => undefined });
    try {
      const executor = drizzle(client, { casing: 'snake_case' });
      const rows = await executor.execute<{ id: number }>(sql`
        with async_tasks as (select * from jsonb_to_recordset(${JSON.stringify(tasks)}::jsonb) as x(id int,status text,heartbeat_at timestamptz,updated_at timestamptz)),
        payment_recon_runs as (select * from jsonb_to_recordset(${JSON.stringify(runs)}::jsonb) as x(id int,status text,task_id int,started_at timestamptz,created_at timestamptz))
        select id from payment_recon_runs where ${stuckPaymentReconRunCondition(now)} order by id
      `);
      expect(rows.map(row => row.id)).toEqual([1, 2, 4]);
    } finally { await client.end(); }
  });
});
