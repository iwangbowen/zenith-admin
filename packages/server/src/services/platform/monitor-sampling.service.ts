/** 由系统调度将宿主机、作业、SQL 和 WebSocket 采样落库。 */
import { sql, desc } from 'drizzle-orm';
import { db } from '../../db';
import { sqlQuerySamples, systemMetricSamples, wsMetricSamples } from '../../db/schema';
import { metricsSampler } from '../../lib/metrics-sampler';
import { takeWsTrendWindow } from '../../lib/ws-trend';
import logger from '../../lib/logger';
import { getSettings } from '../../lib/settings';
import { getJobMonitorAlertMetrics } from './job-monitor-metrics.service';
import { getInfraMetricSnapshot, isCompleteInfraMetricSnapshot } from './monitor-infra-metrics.service';

type SqlQueryStatRow = {
  database_name: string;
  query_id: string;
  query: string;
  calls: number | string;
  total_ms: number | string;
  mean_ms: number | string;
  rows: number | string;
  shared_blks_hit: number | string;
  shared_blks_read: number | string;
  temp_blks_read: number | string;
  temp_blks_written: number | string;
};

/**
 * 采集当前数据库的 Top SQL 累计快照。
 * pg_stat_statements 未安装或未加入 shared_preload_libraries 时跳过，不能影响系统指标采样。
 */
export async function persistSqlQuerySamples(): Promise<number> {
  try {
    const settings = await getSettings('sqlMonitor');
    if (!settings.enabled) return 0;
    const latestRows = await db.execute(sql`SELECT max(sampled_at) AS latest FROM sql_query_samples`);
    const latest = (latestRows as unknown as Array<{ latest: Date | string | null }>)[0]?.latest;
    if (latest && Date.now() - new Date(latest).getTime() < settings.sampleIntervalMinutes * 60_000) return 0;

    const rows = (await db.execute(sql`
      SELECT current_database() AS database_name,
             queryid::text AS query_id,
             query,
             calls::bigint AS calls,
             total_exec_time::float8 AS total_ms,
             mean_exec_time::float8 AS mean_ms,
             rows::bigint AS rows,
             shared_blks_hit::bigint AS shared_blks_hit,
             shared_blks_read::bigint AS shared_blks_read,
             temp_blks_read::bigint AS temp_blks_read,
             temp_blks_written::bigint AS temp_blks_written
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND queryid IS NOT NULL
      ORDER BY total_exec_time DESC
      LIMIT ${settings.sampleLimit}
    `)) as unknown as SqlQueryStatRow[];
    if (rows.length === 0) return 0;

    await db.insert(sqlQuerySamples).values(rows.map((row) => ({
      databaseName: String(row.database_name),
      queryId: String(row.query_id),
      query: String(row.query).slice(0, settings.queryTextMaxChars),
      calls: Number(row.calls ?? 0),
      totalMs: Number(row.total_ms ?? 0),
      meanMs: Number(row.mean_ms ?? 0),
      rows: Number(row.rows ?? 0),
      sharedBlksHit: Number(row.shared_blks_hit ?? 0),
      sharedBlksRead: Number(row.shared_blks_read ?? 0),
      tempBlksRead: Number(row.temp_blks_read ?? 0),
      tempBlksWritten: Number(row.temp_blks_written ?? 0),
    })));
    return rows.length;
  } catch (err) {
    // 扩展缺失属于可降级环境，不应每分钟写 error 日志或阻断其它监控采样。
    logger.debug('[monitor] pg_stat_statements 不可用，跳过 SQL 查询采样', { err: String(err) });
    return 0;
  }
}

/**
 * 落库一条系统指标、一批 SQL 查询采样与一条 WebSocket 连接趋势采样（pg-boss 定时调用，每分钟）。
 * WS 采样取自进程内环形缓冲的增量窗口；窗口不足一个采样周期时 `takeWsTrendWindow` 返回 null，
 * 不写空行，避免曲线被填成 0。
 */
export async function persistMetricSample(): Promise<{
  systemMetricStored: boolean;
  sqlQuerySamples: number;
  wsTrendStored: boolean;
}> {
  let systemMetricStored = false;
  if (metricsSampler.getLatest()) {
    // 采样表的基础设施列均为 NOT NULL；缺少完整快照时跳过本轮，不用 0 伪造历史数据。
    const [s, jobs] = await Promise.all([getInfraMetricSnapshot(), getJobMonitorAlertMetrics()]);
    if (s && isCompleteInfraMetricSnapshot(s)) {
      await db.insert(systemMetricSamples).values({
        cpu: s.cpu,
        memory: s.memory,
        disk: s.disk,
        swap: s.swap,
        load1: s.load1,
        procCpu: s.procCpu,
        heap: s.heap,
        loopLag: s.loopLag,
        qps: s.qps,
        errorRate: s.errorRate,
        netRxBps: s.netRxBps,
        netTxBps: s.netTxBps,
        diskReadBps: s.diskReadBps,
        diskWriteBps: s.diskWriteBps,
        ...jobs,
      });
      systemMetricStored = true;
    }
  }

  const wsTrendStored = await db.transaction(async (tx) => {
    // 手工采样 / Cron / 多 worker 共用同一边界；先锁后读，避免轮换节点重复消费自己的整段缓冲。
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('zenith:ws-metric-samples', 0))`);
    const [latest] = await tx.select({ sampledAt: wsMetricSamples.sampledAt })
      .from(wsMetricSamples).orderBy(desc(wsMetricSamples.sampledAt)).limit(1);
    const wsTrend = takeWsTrendWindow(latest?.sampledAt.getTime() ?? 0);
    if (!wsTrend) return false;
    await tx.insert(wsMetricSamples).values(wsTrend);
    return true;
  });
  return { systemMetricStored, sqlQuerySamples: await persistSqlQuerySamples(), wsTrendStored };
}
