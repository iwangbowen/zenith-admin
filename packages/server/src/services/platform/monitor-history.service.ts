/**
 * 监控指标持久化与历史查询。
 * - persistMetricSample：由 pg-boss 定时任务（默认每分钟）将采样器最新快照落库
 * - getMonitorHistory：按时间范围分桶聚合查询历史趋势
 * - getCurrentMetricSnapshot：返回当前各指标即时值（持久化 / 告警评估共用）
 *
 * 采样数据的保留由 `data-retention` 任务按 `system_metric_samples` 策略统一清理。
 */
import os from 'node:os';
import { sql, gte, type AnyColumn } from 'drizzle-orm';
import { db } from '../../db';
import { sqlQuerySamples, systemMetricSamples, wsMetricSamples } from '../../db/schema';
import { metricsSampler } from '../../lib/metrics-sampler';
import { takeWsTrendWindow } from '../../lib/ws-trend';
import { formatDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import { getSettings } from '../../lib/settings';
import { getDisks, getLinuxMemInfo } from './monitor.service';
import { getLatestEngineHealthMetrics } from '../workflow/workflow-engine-ops.service';
import { getWorkflowJobAlertMetrics } from '../workflow/workflow-jobs.service';
import { getPaymentAlertMetrics, type PaymentAlertMetrics } from '../payment/payment-alert-metrics.service';
import { getOpenPlatformAlertMetrics } from '../open-platform/open-platform-alert-metrics.service';
import { getSchedulerAlertMetrics } from './scheduler-alert-metrics.service';
import { getJobMonitorAlertMetrics, type JobMonitorMetricKey, type JobMonitorAlertMetrics } from './job-monitor-metrics.service';
import { getReplayStorageMbMetric } from '../analytics/session-replays.service';
import { getLogAlertMetrics } from '../../lib/log-metrics';
import { MONITOR_HISTORY_RANGE_CONFIG, type MonitorHistoryRange, type MonitorMetric } from '@zenith/shared/platform';

export type MetricSnapshot = Record<Exclude<MonitorMetric, JobMonitorMetricKey>, number> & JobMonitorAlertMetrics;

/** 基础设施指标（宿主机 / 进程级），全部来自本地采样器，不查数据库。 */
type InfraMetricSnapshot = Pick<
  MetricSnapshot,
  'cpu' | 'memory' | 'disk' | 'swap' | 'load1' | 'procCpu' | 'heap' | 'loopLag'
  | 'qps' | 'errorRate' | 'netRxBps' | 'netTxBps' | 'diskReadBps' | 'diskWriteBps'
>;

/**
 * 采集基础设施指标即时值。磁盘使用率取所有挂载点中的最大值（最易触发容量告警）。
 * 落库的 `system_metric_samples` 只有这部分列，因此定时采样任务只需要这一半。
 */
async function getInfraMetricSnapshot(): Promise<InfraMetricSnapshot> {
  const sample = metricsSampler.getLatest();
  const diskIo = metricsSampler.getDiskIo();
  const [disks, memInfo] = await Promise.all([getDisks(), getLinuxMemInfo()]);
  const disk = disks && disks.length > 0 ? Math.max(...disks.map((d) => d.usagePercent)) : 0;
  const load1 = os.loadavg()[0] ?? 0;
  return {
    cpu: sample?.cpu ?? 0,
    memory: sample?.mem ?? 0,
    disk,
    swap: memInfo?.swapUsagePercent ?? 0,
    load1: Math.round(load1 * 100) / 100,
    procCpu: sample?.procCpu ?? 0,
    heap: sample?.heap ?? 0,
    // 告警口径用窗口 max 而非 mean/p99：10s 窗口约 500 个采样点，一次 300ms 阻塞
    // 只占 0.2%，mean 与 p99 都会把它彻底稀释（冒烟实测 p99 无感），只有峰值能暴露
    loopLag: sample?.loopLagMax ?? 0,
    qps: sample?.qps ?? 0,
    errorRate: sample?.errorRate ?? 0,
    netRxBps: sample?.netRxBps ?? 0,
    netTxBps: sample?.netTxBps ?? 0,
    diskReadBps: diskIo.readBps,
    diskWriteBps: diskIo.writeBps,
  };
}

/** 与租户无关的指标：宿主机采样 + 流程引擎 + 开放平台，多租户下只需取一次 */
type GlobalMetricSnapshot = Omit<MetricSnapshot, keyof PaymentAlertMetrics>;

/** 采集全部 scope 为 'global' 的指标。 */
async function getGlobalMetricSnapshot(): Promise<GlobalMetricSnapshot> {
  const [infra, engineHealth, jobMetrics, openMetrics, replayStorageMb, schedulerMetrics, jobs] = await Promise.all([
    getInfraMetricSnapshot(),
    getLatestEngineHealthMetrics(),
    getWorkflowJobAlertMetrics(),
    getOpenPlatformAlertMetrics(),
    getReplayStorageMbMetric(),
    getSchedulerAlertMetrics(),
    getJobMonitorAlertMetrics(),
  ]);
  return {
    ...infra,
    ...getLogAlertMetrics(),
    ...schedulerMetrics,
    ...jobs,
    workflowHealth: engineHealth.workflowHealth,
    workflowBacklog: engineHealth.workflowBacklog,
    workflowDeadLetter: jobMetrics.workflowDeadLetter,
    workflowFailureRate: jobMetrics.workflowFailureRate,
    workflowStuckRunning: jobMetrics.workflowStuckRunning,
    ...openMetrics,
    replayStorageMb,
  };
}

/**
 * 为一批租户各取一份完整指标快照，供告警评估器按规则所属租户比对阈值。
 *
 * 与租户无关的指标（`MONITOR_METRIC_META` 中 scope 为 'global'）只查一次后共享，
 * 只有业务指标按租户重算——否则多租户下每多一个租户就要重跑一遍宿主机采样与开放平台聚合。
 * 单个租户的业务指标取数失败时该租户没有快照，由调用方跳过其规则，不影响其他租户。
 */
export async function getMetricSnapshotsByTenant(
  tenantIds: readonly (number | null)[],
): Promise<Map<number | null, MetricSnapshot>> {
  const uniqueTenantIds = [...new Set(tenantIds)];
  const snapshots = new Map<number | null, MetricSnapshot>();
  if (uniqueTenantIds.length === 0) return snapshots;

  const global = await getGlobalMetricSnapshot();
  const payments = await Promise.allSettled(uniqueTenantIds.map((tenantId) => getPaymentAlertMetrics(tenantId)));
  payments.forEach((result, index) => {
    if (result.status === 'fulfilled') snapshots.set(uniqueTenantIds[index], { ...global, ...result.value });
    else logger.error('[monitor] 支付域告警指标采集失败，跳过该租户', { tenantId: uniqueTenantIds[index], err: result.reason });
  });
  return snapshots;
}

/**
 * 采集当前全部监控指标的即时值（基础设施 + 各业务域派生指标）。
 *
 * `tenantId` 只影响 scope 为 'tenant' 的业务指标（当前为支付域）；
 * 基础设施、流程引擎与开放平台指标是宿主机 / 平台级口径，与租户无关。
 * 传 null（默认）即平台级全量口径，也是单租户部署下的唯一口径。
 */
export async function getCurrentMetricSnapshot(tenantId: number | null = null): Promise<MetricSnapshot> {
  const [global, paymentMetrics] = await Promise.all([
    getGlobalMetricSnapshot(),
    getPaymentAlertMetrics(tenantId),
  ]);
  return { ...global, ...paymentMetrics };
}

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
    // 采样表只存基础设施列，无需为此触发各业务域的派生指标查询
    const [s, jobs] = await Promise.all([getInfraMetricSnapshot(), getJobMonitorAlertMetrics()]);
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

  const wsTrend = takeWsTrendWindow();
  if (wsTrend) await db.insert(wsMetricSamples).values(wsTrend);
  return { systemMetricStored, sqlQuerySamples: await persistSqlQuerySamples(), wsTrendStored: wsTrend !== null };
}

/**
 * WebSocket 连接趋势的持久化历史：按时间范围分桶聚合。
 *
 * 瞬时列（连接 / 用户 / 空闲）取桶内**最后一个采样值**（用 max(sampled_at) 对应的行，
 * 而非平均——在线连接数被平均后画出来是一个不存在的中间态）；
 * 增量列取桶内之和，失败列取桶内峰值（该列本身已是采样窗口口径）。
 * 分桶窗口与 `MONITOR_HISTORY_RANGE_CONFIG` 同源，与系统指标历史图保持一致的时间轴。
 */
export async function getWsTrendHistory(range: string) {
  const cfg = MONITOR_HISTORY_RANGE_CONFIG[range as MonitorHistoryRange] ?? MONITOR_HISTORY_RANGE_CONFIG['1h'];
  const since = new Date(Date.now() - cfg.windowSec * 1000);
  const bucketExpr = sql<number>`floor(extract(epoch from ${wsMetricSamples.sampledAt}) / ${cfg.bucketSec})`;
  /** 桶内最后一个采样值：按采样时间倒序取数组首元素 */
  const last = (col: AnyColumn) => sql<number>`(array_agg(${col} order by ${wsMetricSamples.sampledAt} desc))[1]::float`;
  const total = (col: AnyColumn) => sql<number>`sum(${col})::float`;
  const rows = await db
    .select({
      bucket: bucketExpr,
      connections: last(wsMetricSamples.connections),
      users: last(wsMetricSamples.users),
      idle: last(wsMetricSamples.idle),
      connects: total(wsMetricSamples.connects),
      disconnects: total(wsMetricSamples.disconnects),
      sent: total(wsMetricSamples.sent),
      recv: total(wsMetricSamples.recv),
      failed: sql<number>`max(${wsMetricSamples.failed})::float`,
    })
    .from(wsMetricSamples)
    .where(gte(wsMetricSamples.sampledAt, since))
    // 与系统指标历史同样按输出第一列（分桶表达式）的序号分组 / 排序，避免 PG 42803
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const round = (value: number) => Math.round(Number(value));
  const points = rows.map((row) => ({
    t: formatDateTime(new Date(Number(row.bucket) * cfg.bucketSec * 1000)),
    connections: round(row.connections),
    users: round(row.users),
    idle: round(row.idle),
    connects: round(row.connects),
    disconnects: round(row.disconnects),
    sent: round(row.sent),
    recv: round(row.recv),
    failed: round(row.failed),
  }));

  return { range, bucketSec: cfg.bucketSec, points };
}

/** 按时间范围分桶聚合查询历史趋势（每桶取平均值 + 峰值）。 */
export async function getMonitorHistory(range: string) {
  const cfg = MONITOR_HISTORY_RANGE_CONFIG[range as MonitorHistoryRange] ?? MONITOR_HISTORY_RANGE_CONFIG['1h'];
  const since = new Date(Date.now() - cfg.windowSec * 1000);
  const bucketExpr = sql<number>`floor(extract(epoch from ${systemMetricSamples.sampledAt}) / ${cfg.bucketSec})`;
  const avg = (col: AnyColumn) => sql<number>`avg(${col})::float`;
  const max = (col: AnyColumn) => sql<number>`max(${col})::float`;
  const rows = await db
    .select({
      bucket: bucketExpr,
      jobsBacklog: avg(systemMetricSamples.jobsBacklog),
      jobsStuck: avg(systemMetricSamples.jobsStuck),
      jobsDead: avg(systemMetricSamples.jobsDead),
      jobsFailed1h: avg(systemMetricSamples.jobsFailed1h),
      cpu: avg(systemMetricSamples.cpu),
      memory: avg(systemMetricSamples.memory),
      disk: avg(systemMetricSamples.disk),
      swap: avg(systemMetricSamples.swap),
      load1: avg(systemMetricSamples.load1),
      procCpu: avg(systemMetricSamples.procCpu),
      heap: avg(systemMetricSamples.heap),
      loopLag: avg(systemMetricSamples.loopLag),
      qps: avg(systemMetricSamples.qps),
      errorRate: avg(systemMetricSamples.errorRate),
      netRxBps: avg(systemMetricSamples.netRxBps),
      netTxBps: avg(systemMetricSamples.netTxBps),
      diskReadBps: avg(systemMetricSamples.diskReadBps),
      diskWriteBps: avg(systemMetricSamples.diskWriteBps),
      cpuMax: max(systemMetricSamples.cpu),
      memoryMax: max(systemMetricSamples.memory),
      diskMax: max(systemMetricSamples.disk),
      swapMax: max(systemMetricSamples.swap),
      load1Max: max(systemMetricSamples.load1),
      procCpuMax: max(systemMetricSamples.procCpu),
      heapMax: max(systemMetricSamples.heap),
      loopLagMax: max(systemMetricSamples.loopLag),
      qpsMax: max(systemMetricSamples.qps),
      errorRateMax: max(systemMetricSamples.errorRate),
      netRxBpsMax: max(systemMetricSamples.netRxBps),
      netTxBpsMax: max(systemMetricSamples.netTxBps),
      diskReadBpsMax: max(systemMetricSamples.diskReadBps),
      diskWriteBpsMax: max(systemMetricSamples.diskWriteBps),
    })
    .from(systemMetricSamples)
    .where(gte(systemMetricSamples.sampledAt, since))
    // 按输出第一列（分桶表达式）的序号分组/排序，避免 drizzle 在 SELECT 与 GROUP BY
    // 两处对同一列渲染限定符不一致触发 PG 42803。
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const round1 = (n: number) => Math.round(Number(n) * 10) / 10;
  const round2 = (n: number) => Math.round(Number(n) * 100) / 100;
  const points = rows.map((r) => ({
    t: formatDateTime(new Date(Number(r.bucket) * cfg.bucketSec * 1000)),
    jobsBacklog: r.jobsBacklog == null ? null : round1(r.jobsBacklog),
    jobsStuck: r.jobsStuck == null ? null : round1(r.jobsStuck),
    jobsDead: r.jobsDead == null ? null : round1(r.jobsDead),
    jobsFailed1h: r.jobsFailed1h == null ? null : round1(r.jobsFailed1h),
    cpu: round1(r.cpu),
    memory: round1(r.memory),
    disk: round1(r.disk),
    swap: round1(r.swap),
    load1: round2(r.load1),
    procCpu: round1(r.procCpu),
    heap: round1(r.heap),
    loopLag: round2(r.loopLag),
    qps: round2(r.qps),
    errorRate: round1(r.errorRate),
    netRxBps: Math.round(Number(r.netRxBps)),
    netTxBps: Math.round(Number(r.netTxBps)),
    diskReadBps: Math.round(Number(r.diskReadBps)),
    diskWriteBps: Math.round(Number(r.diskWriteBps)),
    cpuMax: round1(r.cpuMax),
    memoryMax: round1(r.memoryMax),
    diskMax: round1(r.diskMax),
    swapMax: round1(r.swapMax),
    load1Max: round2(r.load1Max),
    procCpuMax: round1(r.procCpuMax),
    heapMax: round1(r.heapMax),
    loopLagMax: round2(r.loopLagMax),
    qpsMax: round2(r.qpsMax),
    errorRateMax: round1(r.errorRateMax),
    netRxBpsMax: Math.round(Number(r.netRxBpsMax)),
    netTxBpsMax: Math.round(Number(r.netTxBpsMax)),
    diskReadBpsMax: Math.round(Number(r.diskReadBpsMax)),
    diskWriteBpsMax: Math.round(Number(r.diskWriteBpsMax)),
  }));

  if (points.length === 0) logger.debug?.('[monitor] history empty for range', { range });
  return { range, bucketSec: cfg.bucketSec, points };
}
