import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createPgClient } from '../../db/client';
import { jobSourceCountsSchema, jobStuckItemSchema } from '@zenith/shared/platform';
import { getReportDqHealth, listStuckReportDqRuns, stuckReportDqRunCondition } from './report-dq.service';
import { getReportDeliveryHealth, listStuckReportDeliveryRuns } from './report-delivery.service';

describe.skipIf(process.env.RUN_JOB_MONITOR_DB_TESTS !== '1')('report collectors on PostgreSQL without persistent writes', () => {
  it('executes both real collectors and detail queries after taskId migration', async () => {
    for (const [collect, list] of [[getReportDqHealth, listStuckReportDqRuns], [getReportDeliveryHealth, listStuckReportDeliveryRuns]] as const) {
      expect(jobSourceCountsSchema.safeParse((await collect()).counts).success).toBe(true);
      for (const item of await list(5)) expect(jobStuckItemSchema.safeParse(item).success).toBe(true);
    }
  });
  it('protects live and queued executors but reports missing, dead, stale and overdue executions', async () => {
    const now = new Date('2026-10-03T08:00:00Z');
    const old = new Date(now.getTime() - 10 * 60_000).toISOString();
    const fresh = new Date(now.getTime() - 1000).toISOString();
    const tasks = [{ id: 1, status: 'success', heartbeat_at: old, updated_at: old }, { id: 2, status: 'running', heartbeat_at: old, updated_at: old }, { id: 3, status: 'running', heartbeat_at: fresh, updated_at: fresh }, { id: 4, status: 'pending', heartbeat_at: null, updated_at: old }];
    const runs = [
      { id: 1, status: 'running', task_id: null, started_at: old, created_at: old },
      { id: 2, status: 'running', task_id: 1, started_at: old, created_at: old },
      { id: 3, status: 'running', task_id: 2, started_at: old, created_at: old },
      { id: 4, status: 'running', task_id: 3, started_at: old, created_at: old },
      { id: 5, status: 'pending', task_id: null, started_at: null, created_at: fresh },
      { id: 6, status: 'pending', task_id: 4, started_at: null, created_at: old },
      { id: 7, status: 'running', task_id: 3, started_at: new Date(now.getTime() - 1_800_001).toISOString(), created_at: old },
    ];
    const client = createPgClient(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zenith_admin', { max: 1, onnotice: () => undefined });
    try {
      const executor = drizzle(client, { casing: 'snake_case' });
      const rows = await executor.execute<{ id: number }>(sql`
        with async_tasks as (select * from jsonb_to_recordset(${JSON.stringify(tasks)}::jsonb) as x(id int,status text,heartbeat_at timestamptz,updated_at timestamptz)),
        report_dq_runs as (select * from jsonb_to_recordset(${JSON.stringify(runs)}::jsonb) as x(id int,status text,task_id int,started_at timestamptz,created_at timestamptz))
        select id from report_dq_runs where ${stuckReportDqRunCondition(now)} order by id
      `);
      expect(rows.map(row => row.id)).toEqual([1, 2, 3, 7]);
    } finally { await client.end(); }
  });
});
