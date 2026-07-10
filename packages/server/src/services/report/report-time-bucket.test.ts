import { describe, expect, it } from 'vitest';
import { db } from '../../db';
import { reportAssetUsageLogs } from '../../db/schema';
import { reportTimeBucketExpression } from './report-time-bucket';

describe('report time bucket SQL', () => {
  it.each(['hour', 'day'] as const)('inlines the validated %s bucket consistently', (bucket) => {
    const expression = reportTimeBucketExpression(bucket, reportAssetUsageLogs.occurredAt);
    const query = db.select({ bucket: expression })
      .from(reportAssetUsageLogs)
      .groupBy(expression)
      .orderBy(expression)
      .toSQL();

    expect(query.sql.match(new RegExp(`date_trunc\\('${bucket}'`, 'g'))).toHaveLength(3);
    expect(query.params).toEqual([]);
  });
});
