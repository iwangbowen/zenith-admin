import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { closeDb } from '../src/db';
import { isDbReadonlyRoleAvailable } from '../src/lib/db-readonly-role';
import { withDbQueryObserver } from '../src/db/query-metrics';
import { runReportData } from '../src/services/report/report-dataset-execution.service';
import redis from '../src/lib/redis';

try {
  await isDbReadonlyRoleAvailable(); // Exclude one-time role probing from the per-query comparison.
  const query = 'SELECT n::integer AS value FROM generate_series(1, 250000) n WHERE n % 2 = ${parity}';
  const observations = [];
  for (const paged of [false, true]) {
    let queries = 0;
    const start = performance.now();
    const data = await withDbQueryObserver(() => { queries++; }, () => runReportData('sql', {}, { sql: query }, { parity: 0 }, paged ? { page: 1, pageSize: 5 } : { limit: 5 }));
    assert.equal(data.rows.length, 5);
    assert.equal(data.total, paged ? 125000 : null);
    observations.push({ paged, queries, durationMs: +(performance.now() - start).toFixed(2), total: data.total });
  }
  assert.equal(observations[1].queries - observations[0].queries, 1);
  const empty = await runReportData('sql', {}, { sql: query }, { parity: 0 }, { page: 25002, pageSize: 5 });
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.total, 125000);
  process.stdout.write(JSON.stringify({ observations, emptyPage: 'PASS', note: 'query counts include the same read-only guards' }) + '\n');
} finally {
  await closeDb();
  redis.disconnect();
}
