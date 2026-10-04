import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createPgClient } from '../../db/client';
import { orphanRunCondition, ORPHAN_GRACE_MS } from './orphan';

const fixture = pgTable('job_monitor_fixture_runs', { id: integer(), status: text(), taskId: integer(), startedAt: timestamp({ withTimezone: true }) });
describe.skipIf(process.env.RUN_JOB_MONITOR_DB_TESTS !== '1')('orphan conditions on PostgreSQL values without persistent writes', () => {
  it('detects missing, terminal, stale and null executors while preserving grace, queued and healthy executors', async () => {
    const now = new Date('2026-10-03T08:00:00Z');
    const old = new Date(now.getTime() - 5 * 60_000).toISOString();
    const fresh = new Date(now.getTime() - 10_000).toISOString();
    const tasks = [
      { id: 1, status: 'success', heartbeat_at: old, updated_at: old },
      { id: 2, status: 'running', heartbeat_at: old, updated_at: old },
      { id: 3, status: 'running', heartbeat_at: fresh, updated_at: old },
      { id: 4, status: 'pending', heartbeat_at: null, updated_at: old },
      { id: 5, status: 'running', heartbeat_at: null, updated_at: fresh },
    ];
    const runs = [
      { id: 1, status: 'running', task_id: 999, started_at: old },
      { id: 2, status: 'running', task_id: 1, started_at: old },
      { id: 3, status: 'running', task_id: 2, started_at: old },
      { id: 4, status: 'running', task_id: 999, started_at: fresh },
      { id: 5, status: 'running', task_id: 3, started_at: old },
      { id: 6, status: 'pending', task_id: 4, started_at: old },
      { id: 7, status: 'running', task_id: 5, started_at: old },
      { id: 8, status: 'done', task_id: 999, started_at: old },
      { id: 9, status: 'running', task_id: null, started_at: old },
      { id: 10, status: 'running', task_id: 999, started_at: new Date(now.getTime() - ORPHAN_GRACE_MS).toISOString() },
    ];
    const client = createPgClient(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zenith_admin', { max: 1, onnotice: () => undefined });
    try {
      const executor = drizzle(client, { casing: 'snake_case' });
      const condition = orphanRunCondition({ table: fixture, statusColumn: fixture.status, activeStatuses: ['pending', 'running'], taskIdColumn: fixture.taskId, startedAtColumn: fixture.startedAt, asOf: now });
      const rows = await executor.execute<{ id: number }>(sql`
        with async_tasks as (select * from jsonb_to_recordset(${JSON.stringify(tasks)}::jsonb) as x(id int, status text, heartbeat_at timestamptz, updated_at timestamptz)),
        job_monitor_fixture_runs as (select * from jsonb_to_recordset(${JSON.stringify(runs)}::jsonb) as x(id int, status text, task_id int, started_at timestamptz))
        select id from job_monitor_fixture_runs where ${condition} order by id
      `);
      expect(rows.map(row => row.id)).toEqual([1, 2, 3, 9]);
    } finally { await client.end(); }
  });
});
