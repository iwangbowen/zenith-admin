import { sql, type SQL } from 'drizzle-orm';
import { APP_TIME_ZONE_SQL } from '../../lib/datetime-sql';

/** 快照中的业务墙上时间文本（APP_TIME_ZONE 下 YYYY-MM-DD HH:mm:ss）→ 时刻；空串视为 null */
export function cmsWallClockAt(text: SQL): SQL<Date | null> {
  return sql<Date | null>`(nullif(${text}, '')::timestamp AT TIME ZONE ${APP_TIME_ZONE_SQL})`;
}
