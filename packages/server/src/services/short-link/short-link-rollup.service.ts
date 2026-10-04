/**
 * 短链访问日聚合：把今天之前的点击明细物化到 short_link_daily_stats。
 *
 * 幂等 upsert（同日重跑覆盖），先于「数据保留清理」执行，
 * 保证明细被裁剪后长周期趋势仍有数据源。
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { localDayStart, localTime } from '../../lib/datetime-sql';

export async function rollupShortLinkDailyStats(): Promise<number> {
  const statDate = sql`(${localTime(sql`clicked_at`)})::date`;
  const res = await db.execute(sql`
    INSERT INTO short_link_daily_stats (link_id, stat_date, pv, uv)
    SELECT link_id, ${statDate}, count(*), count(DISTINCT visitor_id)
    FROM short_link_clicks
    WHERE is_bot = false AND clicked_at < ${localDayStart(0)}
    GROUP BY link_id, ${statDate}
    ON CONFLICT (link_id, stat_date)
    DO UPDATE SET pv = excluded.pv, uv = excluded.uv
  `);
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}
