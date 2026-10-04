import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { localTrunc } from '../../lib/datetime-sql';

export type ReportTimeBucket = 'hour' | 'day';

export function reportTimeBucketExpression(
  bucket: ReportTimeBucket,
  column: AnyPgColumn,
): SQL<Date> {
  return localTrunc(bucket, column);
}
