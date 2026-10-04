import dayjs from 'dayjs';
import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '../../db';
import { oauth2Clients, openApiCallLogs, openApiCallStatsDaily, openQuotaAlerts } from '../../db/schema';
import { APP_TIME_ZONE } from '../../lib/datetime';
import { localTime } from '../../lib/datetime-sql';

/**
 * 按日聚合开放 API 调用统计，并回收过期的客户端旧密钥与已发送配额告警。
 * 原始调用日志的保留由 `data-retention` 任务按 `open_api_call_logs` 策略统一清理。
 */
export async function rollupOpenApiCallLogs(): Promise<{ statDate: string }> {
  const now = dayjs().tz(APP_TIME_ZONE);
  const statDate = now.subtract(1, 'day').format('YYYY-MM-DD');
  const todayStart = now.startOf('day').toDate();

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
        (${localTime(openApiCallLogs.createdAt)})::date as stat_date,
        ${openApiCallLogs.clientId} as client_id,
        ${openApiCallLogs.appName} as app_name,
        ${openApiCallLogs.path} as path,
        ${openApiCallLogs.environment} as environment,
        ${openApiCallLogs.success} as success,
        ${openApiCallLogs.durationMs} as duration_ms
      from ${openApiCallLogs}
      where ${openApiCallLogs.createdAt} < ${todayStart.toISOString()}::timestamptz
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

  await db.update(oauth2Clients).set({
    previousClientSecretHash: null,
    previousClientSecretEncrypted: null,
    previousSecretExpiresAt: null,
  }).where(lt(oauth2Clients.previousSecretExpiresAt, new Date()));
  await db.delete(openQuotaAlerts).where(and(
    eq(openQuotaAlerts.status, 'sent'),
    lt(openQuotaAlerts.createdAt, now.subtract(180, 'day').toDate()),
  ));

  return { statDate };
}
