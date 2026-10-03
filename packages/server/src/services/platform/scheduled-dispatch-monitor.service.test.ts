import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { jobSourceCountsSchema, jobStuckItemSchema } from '@zenith/shared/platform';
import { getScheduledDispatchHealth, listStuckScheduledDispatch } from './scheduled-dispatch-monitor.service';
import { reportSubscriptionDueCondition } from '../report/report-subscription.service';
import { reportAlertDueCondition } from '../report/report-alert.service';
import { directorySyncScheduledDueCondition } from '../identity/directory-sync-engine';
import { cmsContentScheduledDueCondition } from '../cms/cms-scheduled.service';
import { cmsReleaseDueCondition } from '../cms/cms-releases.service';
import { cmsDistributionDueCondition } from '../cms/cms-distributions-runs.service';

describe.skipIf(process.env.RUN_JOB_MONITOR_DB_TESTS !== '1')('remaining schedule conditions and complete aggregation on PostgreSQL', () => {
  it('runs all eleven real providers and enforces one global oldest-first list limit', async () => {
    const summary = await getScheduledDispatchHealth();
    expect(jobSourceCountsSchema.safeParse(summary.counts).success).toBe(true);
    expect(summary.breakdown).toHaveLength(11);
    expect(summary.counts.pending).toBe(summary.breakdown!.reduce((total, row) => total + row.pending, 0));
    expect(summary.counts.stuck).toBe(summary.breakdown!.reduce((total, row) => total + row.stuck, 0));
    const items = await listStuckScheduledDispatch(5);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(new Set(items.map(item => item.refId)).size).toBe(items.length);
    for (const item of items) expect(jobStuckItemSchema.safeParse(item).success).toBe(true);
    expect(items.map(item => item.ageSec)).toEqual(items.map(item => item.ageSec).sort((a, b) => b - a));
  }, 90_000);
  it('excludes future, disabled, terminal, callback-only, SCIM and unpublished approval candidates consistently', async () => {
    const now = new Date('2026-10-03T08:00:00Z');
    const grace = new Date(now.getTime() - 180_000);
    const old = new Date(now.getTime() - 600_000).toISOString();
    const fresh = new Date(now.getTime() - 60_000).toISOString();
    const future = new Date(now.getTime() + 60_000).toISOString();
    const schedules = [
      { id: 1, enabled: true, next_run_at: old, status: 'enabled', type: 'ldap', cron_expression: '* * * * *', mode: 'scheduled' },
      { id: 2, enabled: true, next_run_at: fresh, status: 'enabled', type: 'ldap', cron_expression: '* * * * *', mode: 'scheduled' },
      { id: 3, enabled: true, next_run_at: future, status: 'enabled', type: 'ldap', cron_expression: '* * * * *', mode: 'scheduled' },
      { id: 4, enabled: false, next_run_at: old, status: 'disabled', type: 'ldap', cron_expression: '* * * * *', mode: 'scheduled' },
      { id: 5, enabled: true, next_run_at: null, status: 'enabled', type: 'ldap', cron_expression: '* * * * *', mode: 'scheduled' },
      { id: 6, enabled: true, next_run_at: old, status: 'enabled', type: 'scim', cron_expression: '* * * * *', mode: 'manual' },
      { id: 7, enabled: true, next_run_at: old, status: 'enabled', type: 'ldap', cron_expression: ' ', mode: 'manual' },
    ];
    const releases = [{ id: 1, status: 'scheduled', activate_at: old }, { id: 2, status: 'scheduled', activate_at: future }, { id: 3, status: 'active', activate_at: old }, { id: 4, status: 'scheduled', activate_at: null }];
    const client = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/zenith_admin', { max: 1, onnotice: () => undefined });
    try {
      const executor = drizzle(client, { casing: 'snake_case' });
      for (const domain of [
        { table: 'report_dashboard_subscriptions', due: reportSubscriptionDueCondition, expected: [1, 6, 7] },
        { table: 'report_alert_rules', due: reportAlertDueCondition, expected: [1, 6, 7] },
        { table: 'directory_sync_sources', due: directorySyncScheduledDueCondition, expected: [1] },
        { table: 'cms_distribution_rules', due: cmsDistributionDueCondition, expected: [1] },
      ]) {
        const table = sql.identifier(domain.table);
        const rows = await executor.execute<{ id: number }>(sql`with ${table} as (select * from jsonb_to_recordset(${JSON.stringify(schedules)}::jsonb) as x(id int,enabled boolean,next_run_at timestamptz,status text,type text,cron_expression text,mode text))
          select id from ${table} where ${domain.due(grace)} order by id`);
        expect(rows.map(row => row.id), domain.table).toEqual(domain.expected);
      }
      const rows = await executor.execute<{ id: number }>(sql`with cms_releases as (select * from jsonb_to_recordset(${JSON.stringify(releases)}::jsonb) as x(id int,status text,activate_at timestamptz))
        select id from cms_releases where ${cmsReleaseDueCondition(grace)} order by id`);
      expect(rows.map(row => row.id)).toEqual([1]);
      const contentRows = await executor.execute<{ id: number }>(sql`
        with cms_contents(id,deleted_at,locked_at) as (values (1,null::timestamptz,null::timestamptz),(2,null,null),(3,now(),null),(4,null,now()),(5,null,null),(6,null,null)),
        cms_content_working_copies(content_id,approved_revision_id,published_revision_id) as (values (1,11,null::int),(2,12,12),(3,13,null),(4,14,null),(5,15,null),(6,16,null)),
        cms_content_revisions(id,snapshot) as (values (11,'{"scheduledAt":"2026-10-03 15:50:00"}'::jsonb),(12,'{"scheduledAt":"2026-10-03 15:50:00"}'),(13,'{"scheduledAt":"2026-10-03 15:50:00"}'),(14,'{"scheduledAt":"2026-10-03 15:50:00"}'),(15,'{"scheduledAt":"2026-10-03 16:01:00"}'),(16,'{}'))
        select cms_contents.id from cms_content_working_copies inner join cms_contents on cms_contents.id=cms_content_working_copies.content_id
        inner join cms_content_revisions on cms_content_revisions.id=cms_content_working_copies.approved_revision_id where ${cmsContentScheduledDueCondition(grace)} order by cms_contents.id
      `);
      expect(contentRows.map(row => row.id)).toEqual([1]);
    } finally { await client.end(); }
  });
});
