import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createPgClient } from '../../db/client';
import { db } from '../../db';
import { jobStuckItemSchema } from '@zenith/shared/platform';
import { getDeployRunHealth, listStuckDeployRuns, stuckDeployRunCondition } from './deploy-job-monitor.service';

afterEach(() => vi.restoreAllMocks());
describe('deploy job monitor health', () => {
  it('keeps executor volume at zero and reports partially successful deployments', async () => {
    const original = db.select.bind(db);
    vi.spyOn(db, 'select').mockImplementation((fields?: Parameters<typeof db.select>[0]) => {
      if (!fields || !('stuck' in fields)) return original(fields);
      const builder = { from: () => builder, where: () => Promise.resolve([{ stuck: 2, failed24h: 3, succeeded24h: 9, failed1h: 1, partial24h: 4 }]) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return builder as any;
    });
    const health = await getDeployRunHealth();
    expect(health.counts).toEqual({ pending: 0, running: 0, stuck: 2, dead: null, failed24h: 3, succeeded24h: 9 });
    expect(health.issues).toEqual([{ level: 'warn', message: expect.stringContaining('4 次') }]);
  });
  it('projects one safe deployment item and preserves the caller limit', async () => {
    const original = db.select.bind(db);
    const now = Date.now();
    const rows = [{ id: 6, kind: 'deploy', version: '1.0', status: 'running', startedAt: new Date(now - 3_600_000), createdAt: new Date(now - 3_600_000), updatedAt: new Date(now - 600_000), error: null }];
    const limit = vi.fn(async () => rows);
    const builder = { from: () => builder, where: () => builder, orderBy: () => builder, limit };
    vi.spyOn(db, 'select').mockImplementation((fields?: Parameters<typeof db.select>[0]) => {
      if (!fields || !('kind' in fields)) return original(fields);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return builder as any;
    });
    const [item] = await listStuckDeployRuns(9);
    expect(limit).toHaveBeenCalledWith(9);
    expect(item).toMatchObject({ refId: '6', title: 'deploy / 1.0' });
    expect(jobStuckItemSchema.safeParse(item).success).toBe(true);
    expect(item).not.toHaveProperty('snapshot');
  });
});

describe.skipIf(process.env.RUN_JOB_MONITOR_DB_TESTS !== '1')('deploy orphan and host deadlines on PostgreSQL fixtures', () => {
  it('counts one run for several overdue hosts and protects live executors and startup grace', async () => {
    const now = new Date('2026-10-03T08:00:00Z');
    const old = new Date(now.getTime() - 3_600_000).toISOString();
    const fresh = new Date(now.getTime() - 10_000).toISOString();
    const tasks = [{ id: 1, status: 'running', heartbeat_at: fresh, updated_at: fresh }];
    const runs = [
      { id: 1, status: 'pending', async_task_id: 999, started_at: null, created_at: old },
      { id: 2, status: 'running', async_task_id: 1, started_at: old, created_at: old },
      { id: 3, status: 'running', async_task_id: 1, started_at: old, created_at: old },
      { id: 4, status: 'pending', async_task_id: 999, started_at: null, created_at: fresh },
      { id: 5, status: 'succeeded', async_task_id: 1, started_at: old, created_at: old },
    ];
    const hosts = [
      { id: 21, run_id: 2, status: 'running', started_at: old }, { id: 22, run_id: 2, status: 'running', started_at: old },
      { id: 31, run_id: 3, status: 'running', started_at: fresh }, { id: 51, run_id: 5, status: 'running', started_at: old },
    ];
    const client = createPgClient(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zenith_admin', { max: 1, onnotice: () => undefined });
    try {
      const executor = drizzle(client, { casing: 'snake_case' });
      const result = await executor.execute<{ id: number }>(sql`
        with async_tasks as (select * from jsonb_to_recordset(${JSON.stringify(tasks)}::jsonb) as x(id int,status text,heartbeat_at timestamptz,updated_at timestamptz)),
        deploy_runs as (select * from jsonb_to_recordset(${JSON.stringify(runs)}::jsonb) as x(id int,status text,async_task_id int,started_at timestamptz,created_at timestamptz)),
        deploy_run_hosts as (select * from jsonb_to_recordset(${JSON.stringify(hosts)}::jsonb) as x(id int,run_id int,status text,started_at timestamptz))
        select id from deploy_runs where ${stuckDeployRunCondition(now)} order by id
      `);
      expect(result.map(row => row.id)).toEqual([1, 2, 5]);
    } finally { await client.end(); }
  });
});
