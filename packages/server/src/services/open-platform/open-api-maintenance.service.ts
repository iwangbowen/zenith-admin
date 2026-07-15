import dayjs from 'dayjs';
import { lt, sql } from 'drizzle-orm';
import { db } from '../../db';
import { oauth2Clients, openApiCallLogs, openApiCallStatsDaily } from '../../db/schema';
import { config } from '../../config';

export async function rollupAndCleanupOpenApiCallLogs(): Promise<{
  statDate: string;
  retentionDays: number;
}> {
  const statDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  const start = dayjs(statDate).startOf('day').toDate();
  const end = dayjs(statDate).add(1, 'day').startOf('day').toDate();

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
      ${statDate}::date,
      ${openApiCallLogs.clientId},
      max(${openApiCallLogs.appName}),
      ${openApiCallLogs.path},
      ${openApiCallLogs.environment},
      count(*)::bigint,
      count(*) filter (where ${openApiCallLogs.success} = true)::bigint,
      count(*) filter (where ${openApiCallLogs.success} = false)::bigint,
      coalesce(sum(${openApiCallLogs.durationMs}), 0)::bigint,
      coalesce(max(${openApiCallLogs.durationMs}), 0)::integer
    from ${openApiCallLogs}
    where ${openApiCallLogs.createdAt} >= ${start}
      and ${openApiCallLogs.createdAt} < ${end}
    group by ${openApiCallLogs.clientId}, ${openApiCallLogs.path}, ${openApiCallLogs.environment}
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
  const cutoff = dayjs().subtract(retentionDays, 'day').startOf('day').toDate();
  await db.delete(openApiCallLogs).where(lt(openApiCallLogs.createdAt, cutoff));
  await db.update(oauth2Clients).set({
    previousClientSecretHash: null,
    previousClientSecretEncrypted: null,
    previousSecretExpiresAt: null,
  }).where(lt(oauth2Clients.previousSecretExpiresAt, new Date()));

  return { statDate, retentionDays };
}
