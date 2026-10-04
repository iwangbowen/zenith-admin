import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createPgClient } from '../../db/client';
import { db } from '../../db';
import type { DbTransaction } from '../../db/types';
import { jobSourceCountsSchema, jobStuckItemSchema } from '@zenith/shared/platform';
import { getCmsPipelineHealth, listStuckCmsPipelineJobs, stuckCmsDeliveryCondition, stuckCmsDeploymentCondition, stuckCmsMediaCondition } from './cms-pipeline-job-monitor.service';

afterEach(() => vi.restoreAllMocks());
it('reports all pipeline subtypes in breakdown without duplicate executor volume', async () => {
  const snapshot = vi.spyOn(db, 'transaction').mockImplementation(async work => work(db as unknown as DbTransaction));
  const original = db.select.bind(db);
  const aggregates = [{ stuck: 1, failed24h: 2, failed1h: 1 }, { stuck: 2, failed24h: 3, failed1h: 1, succeeded24h: 4 }, { stuck: 3, failed24h: 4, failed1h: 2, succeeded24h: 5 }];
  vi.spyOn(db, 'select').mockImplementation((fields?: Parameters<typeof db.select>[0]) => {
    if (!fields || !('stuck' in fields)) return original(fields);
    const row = aggregates.shift();
    const builder = { from: () => builder, where: () => Promise.resolve([row]) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return builder as any;
  });
  const health = await getCmsPipelineHealth();
  expect(health.counts).toEqual({ pending: 0, running: 0, stuck: 6, dead: null, failed24h: 9, succeeded24h: 9 });
  expect(health.failed1h).toBe(4);
  expect(snapshot).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'repeatable read', accessMode: 'read only' });
  expect(health.breakdown?.map(item => [item.key, item.stuck])).toEqual([['build', 1], ['delivery', 2], ['media', 3]]);
});

it('merges subtype lists with stable qualified ids and applies one global limit by age', async () => {
  const original = db.select.bind(db);
  const now = Date.now();
  const limits = [vi.fn(), vi.fn(), vi.fn()];
  vi.spyOn(db, 'select').mockImplementation((fields?: Parameters<typeof db.select>[0]) => {
    if (!fields || (!('siteId' in fields) && !('errorMessage' in fields))) return original(fields);
    const index = 'errorMessage' in fields ? 2 : 'startedAt' in fields ? 1 : 0;
    const elapsed = [3_600_000, 1_200_000, 1_800_000][index];
    const rows = [{ id: 7, siteId: 1, createdAt: new Date(now - elapsed), updatedAt: new Date(now - elapsed), startedAt: null, error: null, errorMessage: null, status: 'running' }];
    limits[index].mockResolvedValue(rows);
    const builder = { from: () => builder, where: () => builder, orderBy: () => builder, limit: limits[index] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return builder as any;
  });
  const items = await listStuckCmsPipelineJobs(2);
  expect(items.map(item => item.refId)).toEqual(['build:7', 'media:7']);
  expect(limits.every(limit => limit.mock.calls[0][0] === 2)).toBe(true);
  for (const item of items) expect(jobStuckItemSchema.safeParse(item).success).toBe(true);
});

describe.skipIf(process.env.RUN_JOB_MONITOR_DB_TESTS !== '1')('CMS pipeline orphans on PostgreSQL fixtures', () => {
  it('executes actual health aggregations without writes, validating date parameter encoding', async () => {
    const [notification, webhooks, watches, telemetry, payment, drive, deploy, broadcast, recon] = await Promise.all([
      import('../messaging/notification-outbox.service'), import('../open-platform/app-webhooks.service'),
      import('../platform/entity-watch-worker'), import('./cms-telemetry-deliveries.service'),
      import('../payment/payment-events.service'), import('../drive/drive-renditions.service'),
      import('../ops/deploy-job-monitor.service'), import('../messaging/broadcast-job-monitor.service'),
      import('../payment/payment-recon-job-monitor.service'),
    ]);
    const summaries = await Promise.all([
      notification.getNotificationOutboxHealth(), webhooks.getWebhookDeliveryHealth(), watches.getEntityWatchDeliveryHealth(),
      telemetry.getCmsTelemetryOutboxHealth(), payment.getPaymentEventHealth(), drive.getDriveRenditionHealth(),
      deploy.getDeployRunHealth(), broadcast.getBroadcastHealth(), getCmsPipelineHealth(), recon.getPaymentReconHealth(),
    ]);
    for (const summary of summaries) expect(jobSourceCountsSchema.safeParse(summary.counts).success).toBe(true);
  }, 90_000); // Cold dynamic imports are outside the collector's normal bootstrap lifecycle.
  it('requires every linked build task to be dead, excludes settled delivery rows and protects media executor grace', async () => {
    const now = new Date('2026-10-03T08:00:00Z');
    const old = new Date(now.getTime() - 600_000).toISOString();
    const fresh = new Date(now.getTime() - 10_000).toISOString();
    const tasks = [
      { id: 1, status: 'success', heartbeat_at: old, updated_at: old },
      { id: 2, status: 'running', heartbeat_at: fresh, updated_at: fresh },
      { id: 3, status: 'pending', heartbeat_at: null, updated_at: old },
      { id: 4, status: 'running', heartbeat_at: old, updated_at: old },
    ];
    const builds = [
      { id: 1, status: 'building', task_ids: [], created_at: old },
      { id: 2, status: 'building', task_ids: [1, 2], created_at: old },
      { id: 3, status: 'building', task_ids: [1, 4], created_at: old },
      { id: 4, status: 'building', task_ids: [999], created_at: fresh },
      { id: 5, status: 'building', task_ids: [1, 3], created_at: old },
      { id: 6, status: 'active', task_ids: [1], created_at: old },
    ];
    const deliveries = [
      { id: 1, status: 'activated', purge_status: 'pending', task_id: 1, started_at: null, created_at: old },
      { id: 2, status: 'superseded', purge_status: 'pending', task_id: 999, started_at: null, created_at: old },
      { id: 3, status: 'passed', purge_status: 'pending', task_id: 999, started_at: old, created_at: old },
      { id: 4, status: 'checking', purge_status: 'accepted', task_id: 1, started_at: old, created_at: old },
      { id: 5, status: 'activated', purge_status: 'pending', task_id: 2, started_at: null, created_at: old },
    ];
    const media = [
      { id: 1, status: 'running', task_id: 1, updated_at: old },
      { id: 2, status: 'pending', task_id: 999, updated_at: fresh },
      { id: 3, status: 'running', task_id: 2, updated_at: old },
      { id: 4, status: 'pending', task_id: 3, updated_at: old },
    ];
    const client = createPgClient(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zenith_admin', { max: 1, onnotice: () => undefined });
    try {
      const executor = drizzle(client, { casing: 'snake_case' });
      const rows = await executor.execute<{ kind: string; id: number }>(sql`
        with async_tasks as (select * from jsonb_to_recordset(${JSON.stringify(tasks)}::jsonb) as x(id int,status text,heartbeat_at timestamptz,updated_at timestamptz)),
        cms_deployments as (select * from jsonb_to_recordset(${JSON.stringify(builds)}::jsonb) as x(id int,status text,task_ids jsonb,created_at timestamptz)),
        cms_delivery_runs as (select * from jsonb_to_recordset(${JSON.stringify(deliveries)}::jsonb) as x(id int,status text,purge_status text,task_id int,started_at timestamptz,created_at timestamptz)),
        cms_media_processing as (select * from jsonb_to_recordset(${JSON.stringify(media)}::jsonb) as x(id int,status text,task_id int,updated_at timestamptz))
        select 'build' as kind,id from cms_deployments where ${stuckCmsDeploymentCondition(now)}
        union all select 'delivery' as kind,id from cms_delivery_runs where ${stuckCmsDeliveryCondition(now)}
        union all select 'media' as kind,id from cms_media_processing where ${stuckCmsMediaCondition(now)} order by kind,id
      `);
      expect(rows.map(row => `${row.kind}:${row.id}`)).toEqual(['build:1', 'build:3', 'delivery:1', 'media:1']);
    } finally { await client.end(); }
  });
});
