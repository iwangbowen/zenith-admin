import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createPgClient } from '../../db/client';
import { sql } from 'drizzle-orm';
import { JOB_MONITOR_SCHEDULE_GRACE_MS } from '@zenith/shared/platform';
import { config } from '../../config';
import { chatScheduledMessageDueCondition } from '../chat/chat-scheduled.service';
import { channelScheduledMessageDueCondition } from '../messaging/channel.service';
import { mpBroadcastDueCondition } from '../mp/mp-broadcast.service';
import { workflowScheduleDueCondition } from '../workflow/workflow-schedules.service';
import { iotScheduleDueCondition } from '../iot/iot-schedules.service';

const now = new Date('2026-10-03T08:00:00Z');
const dialect = new PgDialect({ casing: 'snake_case' });
const domains = [
  { name: 'chat', due: chatScheduledMessageDueCondition, table: 'chat_scheduled_messages', status: 'pending', otherStatus: 'sent', date: 'scheduled_at', timezone: true },
  { name: 'channel', due: channelScheduledMessageDueCondition, table: 'channel_messages', status: 'scheduled', otherStatus: 'draft', date: 'scheduled_at', timezone: true },
  { name: 'mp', due: mpBroadcastDueCondition, table: 'mp_broadcasts', status: 'draft', otherStatus: 'sent', date: 'scheduled_at', timezone: false },
  { name: 'workflow', due: workflowScheduleDueCondition, table: 'workflow_schedules', status: 'enabled', otherStatus: 'disabled', date: 'next_run_at', timezone: true },
  { name: 'iot', due: iotScheduleDueCondition, table: 'iot_schedules', status: 'enabled', otherStatus: 'disabled', date: 'next_run_at', timezone: false },
] as const;

describe('domain due conditions shared by dispatcher and monitor', () => {
  it.each(domains)('$name binds the exact domain status and supplied timestamp cutoff', (domain) => {
    const query = dialect.sqlToQuery(domain.due(now)!);
    expect(query.params).toEqual([domain.status, now.toISOString()]);
    expect(query.sql).toContain(`"${domain.date}" <=`);
    const grace = new Date(now.getTime() - JOB_MONITOR_SCHEDULE_GRACE_MS);
    expect(dialect.sqlToQuery(domain.due(grace)!).params).toEqual([domain.status, grace.toISOString()]);
  });
});

describe.skipIf(process.env.RUN_JOB_MONITOR_DB_TESTS !== '1')('scheduled domain conditions on PostgreSQL fixtures without writes', () => {
  it('separates all due rows from overdue rows and rejects future, inactive and null dates in all five domains', async () => {
    const client = createPgClient(config.databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => undefined });
    const executor = drizzle(client, { casing: 'snake_case' });
    try {
      for (const domain of domains) {
        const at = (offset: number) => new Date(now.getTime() + offset).toISOString();
        const fixtures = [
          { id: 1, status: domain.status, [domain.date]: at(0) },
          { id: 2, status: domain.status, [domain.date]: at(120_000) },
          { id: 3, status: domain.status, [domain.date]: at(-240_000) },
          { id: 4, status: domain.otherStatus, [domain.date]: at(-240_000) },
          { id: 5, status: domain.status, [domain.date]: null },
          { id: 6, status: domain.status, [domain.date]: at(-60_000) },
          { id: 7, status: domain.status, [domain.date]: at(-JOB_MONITOR_SCHEDULE_GRACE_MS) },
        ];
        const read = (asOf: Date) => executor.execute<{ id: number }>(sql`
          with ${sql.identifier(domain.table)} as (
            select * from jsonb_to_recordset(${JSON.stringify(fixtures)}::jsonb)
            as x(id int, status text, ${sql.identifier(domain.date)} ${domain.timezone ? sql`timestamptz` : sql`timestamp`})
          )
          select id from ${sql.identifier(domain.table)} where ${domain.due(asOf)} order by id
        `);
        expect((await read(now)).map(row => row.id), domain.name).toEqual([1, 3, 6, 7]);
        expect((await read(new Date(now.getTime() - JOB_MONITOR_SCHEDULE_GRACE_MS))).map(row => row.id), domain.name).toEqual([3, 7]);
      }
    } finally { await client.end(); }
  }, 60_000);
});
