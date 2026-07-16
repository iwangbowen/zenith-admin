import dayjs from 'dayjs';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../db';
import { oauth2Clients, oauth2Tokens, openApiCallLogs, openApiCallStatsDaily, openQuotaAlerts } from '../../db/schema';
import { config } from '../../config';
import { APP_TIME_ZONE } from '../../lib/datetime';

const APP_TIME_ZONE_SQL = sql.raw(`'${APP_TIME_ZONE.replaceAll("'", "''")}'`);

export async function invalidateLegacyOAuthTokens(): Promise<number> {
  const rows = await db.update(oauth2Tokens).set({ revoked: true }).where(and(
    isNull(oauth2Tokens.familyId),
    eq(oauth2Tokens.revoked, false),
  )).returning({ id: oauth2Tokens.id });
  return rows.length;
}

export async function rollupAndCleanupOpenApiCallLogs(): Promise<{
  statDate: string;
  retentionDays: number;
}> {
  const now = dayjs().tz(APP_TIME_ZONE);
  const statDate = now.subtract(1, 'day').format('YYYY-MM-DD');
  const todayStart = now.startOf('day').toDate();
  const databaseTodayStart = dayjs(todayStart).utc().format('YYYY-MM-DD HH:mm:ss');

  await db.execute(sql`
    insert into ${openApiCallStatsDaily} (
      stat_date,
      client_id,
      app_name,
      path,
      environment,
      total_calls,
      success_calls,
      failed_calls,
      duration_sum_ms,
      max_duration_ms
    )
    select
      source.stat_date,
      source.client_id,
      max(source.app_name),
      source.path,
      source.environment,
      count(*)::bigint,
      count(*) filter (where source.success = true)::bigint,
      count(*) filter (where source.success = false)::bigint,
      coalesce(sum(source.duration_ms), 0)::bigint,
      coalesce(max(source.duration_ms), 0)::integer
    from (
      select
        (${openApiCallLogs.createdAt} at time zone 'UTC' at time zone ${APP_TIME_ZONE_SQL})::date as stat_date,
        ${openApiCallLogs.clientId} as client_id,
        ${openApiCallLogs.appName} as app_name,
        ${openApiCallLogs.path} as path,
        ${openApiCallLogs.environment} as environment,
        ${openApiCallLogs.success} as success,
        ${openApiCallLogs.durationMs} as duration_ms
      from ${openApiCallLogs}
      where ${openApiCallLogs.createdAt} < ${databaseTodayStart}::timestamp
    ) source
    group by
      source.stat_date,
      source.client_id,
      source.path,
      source.environment
    on conflict (stat_date, client_id, path, environment) do update set
      app_name = excluded.app_name,
      total_calls = excluded.total_calls,
      success_calls = excluded.success_calls,
      failed_calls = excluded.failed_calls,
      duration_sum_ms = excluded.duration_sum_ms,
      max_duration_ms = excluded.max_duration_ms,
      updated_at = now()
  `);

  const retentionDays = config.openPlatform.apiLogRetentionDays;
  const cutoff = now.subtract(retentionDays, 'day').startOf('day').toDate();
  await db.delete(openApiCallLogs).where(lt(openApiCallLogs.createdAt, cutoff));
  await db.update(oauth2Clients).set({
    previousClientSecretHash: null,
    previousClientSecretEncrypted: null,
    previousSecretExpiresAt: null,
  }).where(lt(oauth2Clients.previousSecretExpiresAt, new Date()));
  await db.delete(openQuotaAlerts).where(and(
    eq(openQuotaAlerts.status, 'sent'),
    lt(openQuotaAlerts.createdAt, now.subtract(180, 'day').toDate()),
  ));

  return { statDate, retentionDays };
}
