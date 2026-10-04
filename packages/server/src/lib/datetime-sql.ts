/**
 * SQL 中按业务时区（APP_TIME_ZONE）分桶、取日界的唯一写法。入参必须是时刻（timestamptz 列或表达式）。
 * 时区与格式以字面量内联（不占绑定参数）：同一表达式出现在 SELECT / GROUP BY / ORDER BY 时文本一致，
 * 绑定参数会生成不同占位符，PostgreSQL 无法判等而报错。
 */
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { APP_TIME_ZONE } from './datetime';

export const APP_TIME_ZONE_LITERAL = `'${APP_TIME_ZONE.replaceAll("'", "''")}'`;
export const APP_TIME_ZONE_SQL = sql.raw(APP_TIME_ZONE_LITERAL);

export type LocalTimePattern =
  | 'YYYY-MM-DD'
  | 'YYYY-MM'
  | 'YYYY-MM-DD HH24:00'
  | 'YYYY-MM-DD HH24:00:00'
  | 'YYYY-MM-DD HH24:MI:SS';
export type LocalTruncUnit = 'hour' | 'day' | 'week' | 'month';

/** 时刻在业务时区的墙上时间（timestamp），供 extract(hour | isodow …) 使用 */
export function localTime(instant: SQLWrapper): SQL {
  return sql`timezone(${APP_TIME_ZONE_SQL}, ${instant})`;
}

/** 按业务时区格式化时刻 */
export function localFormat(instant: SQLWrapper, pattern: LocalTimePattern): SQL<string> {
  return sql<string>`to_char(timezone(${APP_TIME_ZONE_SQL}, ${instant}), ${sql.raw(`'${pattern}'`)})`;
}

/** 业务时区自然日 YYYY-MM-DD（按天分组的唯一写法） */
export function localDate(instant: SQLWrapper): SQL<string> {
  return localFormat(instant, 'YYYY-MM-DD');
}

/** 按业务时区截断到整点 / 零点 / 周一 / 月初，结果仍是时刻（timestamptz） */
export function localTrunc(unit: LocalTruncUnit, instant: SQLWrapper): SQL<Date> {
  return sql<Date>`date_trunc(${sql.raw(`'${unit}'`)}, ${instant}, ${APP_TIME_ZONE_SQL})`;
}

/** 业务时区「今天往前 daysAgo 天」的 00:00（timestamptz）；0 = 今日零点；跨夏令时也落在当地零点 */
export function localDayStart(daysAgo = 0): SQL<Date> {
  const days = Math.trunc(daysAgo);
  if (!Number.isFinite(days) || days < 0) throw new Error(`localDayStart: 非法天数 ${daysAgo}`);
  return sql<Date>`((timezone(${APP_TIME_ZONE_SQL}, now())::date - ${sql.raw(String(days))})::timestamp AT TIME ZONE ${APP_TIME_ZONE_SQL})`;
}
