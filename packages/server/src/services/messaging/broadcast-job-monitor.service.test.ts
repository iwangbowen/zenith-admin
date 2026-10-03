import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { db } from '../../db';
import { jobStuckItemSchema } from '@zenith/shared/platform';
import { getBroadcastHealth, listStuckBroadcasts, stuckBroadcastCondition } from './broadcast-job-monitor.service';

afterEach(() => vi.restoreAllMocks());
it('reports incomplete delivery without counting the task executor twice', async () => {
  const original = db.select.bind(db);
  vi.spyOn(db, 'select').mockImplementation((fields?: Parameters<typeof db.select>[0]) => {
    if (!fields || !('stuck' in fields)) return original(fields);
    const builder = { from: () => builder, where: () => Promise.resolve([{ stuck: 2, incomplete: 1, failed24h: 3, succeeded24h: 10, failed1h: 1 }]) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return builder as any;
  });
  const health = await getBroadcastHealth();
  expect(health.counts).toEqual({ pending: 0, running: 0, stuck: 2, dead: null, failed24h: 3, succeeded24h: 10 });
  expect(health.issues).toEqual([{ level: 'warn', message: expect.stringContaining('1 个') }]);
});

it('shows audience progress without returning message content or recipient ids', async () => {
  const original = db.select.bind(db);
  const now = Date.now();
  const rows = [{ id: 3, title: '群发通知', createdAt: new Date(now - 86_400_000), updatedAt: new Date(now - 600_000), totalRecipients: 30, enqueuedCount: 20 }];
  const limit = vi.fn(async () => rows);
  const builder = { from: () => builder, where: () => builder, orderBy: () => builder, limit };
  vi.spyOn(db, 'select').mockImplementation((fields?: Parameters<typeof db.select>[0]) => {
    if (!fields || !('title' in fields)) return original(fields);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return builder as any;
  });
  const [item] = await listStuckBroadcasts(8);
  expect(limit).toHaveBeenCalledWith(8);
  expect(item.detail).toContain('20/30');
  expect(item.ageSec).toBeGreaterThanOrEqual(600);
  expect(item.ageSec).toBeLessThan(610);
  expect(jobStuckItemSchema.safeParse(item).success).toBe(true);
  expect(item).not.toHaveProperty('content');
  expect(item).not.toHaveProperty('audienceIds');
});

describe.skipIf(process.env.RUN_JOB_MONITOR_DB_TESTS !== '1')('broadcast orphan conditions on PostgreSQL fixtures', () => {
  it('detects abandoned and incomplete terminal campaigns while preserving live executors and finalization grace', async () => {
    const now = new Date('2026-10-03T08:00:00Z');
    const old = new Date(now.getTime() - 600_000).toISOString();
    const fresh = new Date(now.getTime() - 10_000).toISOString();
    const tasks = [
      { id: 1, status: 'success', heartbeat_at: old, updated_at: old },
      { id: 2, status: 'running', heartbeat_at: fresh, updated_at: fresh },
      { id: 3, status: 'pending', heartbeat_at: null, updated_at: old },
    ];
    const campaigns = [
      { id: 1, status: 'sending', task_id: 999, updated_at: old, enqueued_count: 0, total_recipients: null },
      { id: 2, status: 'sending', task_id: 1, updated_at: old, enqueued_count: 5, total_recipients: 10 },
      { id: 3, status: 'sending', task_id: 2, updated_at: old, enqueued_count: 5, total_recipients: 10 },
      { id: 4, status: 'sending', task_id: 1, updated_at: fresh, enqueued_count: 5, total_recipients: 10 },
      { id: 5, status: 'sending', task_id: 3, updated_at: old, enqueued_count: 0, total_recipients: 10 },
      { id: 6, status: 'sent', task_id: 999, updated_at: old, enqueued_count: 10, total_recipients: 10 },
    ];
    const client = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zenith_admin', { max: 1, onnotice: () => undefined });
    try {
      const executor = drizzle(client, { casing: 'snake_case' });
      const rows = await executor.execute<{ id: number }>(sql`
        with async_tasks as (select * from jsonb_to_recordset(${JSON.stringify(tasks)}::jsonb) as x(id int,status text,heartbeat_at timestamptz,updated_at timestamptz)),
        broadcast_campaigns as (select * from jsonb_to_recordset(${JSON.stringify(campaigns)}::jsonb) as x(id int,status text,task_id int,updated_at timestamptz,enqueued_count int,total_recipients int))
        select id from broadcast_campaigns where ${stuckBroadcastCondition(now)} order by id
      `);
      expect(rows.map(row => row.id)).toEqual([1, 2]);
    } finally { await client.end(); }
  });
});
