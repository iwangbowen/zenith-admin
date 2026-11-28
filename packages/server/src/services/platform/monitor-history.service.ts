/** 系统指标与 WebSocket 采样的历史查询。 */
import { sql, gte, type AnyColumn } from 'drizzle-orm';
import { db } from '../../db';
import { systemMetricSamples, wsMetricSamples } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import { MONITOR_HISTORY_RANGE_CONFIG, type MonitorHistoryRange } from '@zenith/shared/platform';

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
