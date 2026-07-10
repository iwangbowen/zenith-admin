import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export type ReportTimeBucket = 'hour' | 'day';

export function reportTimeBucketExpression(
  bucket: ReportTimeBucket,
  column: AnyPgColumn,
): SQL<Date> {
  return bucket === 'hour'
    ? sql<Date>`date_trunc('hour', ${column})`
    : sql<Date>`date_trunc('day', ${column})`;
}
