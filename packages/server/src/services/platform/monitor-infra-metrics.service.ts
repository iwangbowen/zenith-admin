import os from 'node:os';
import type { MonitorMetric } from '@zenith/shared/platform';
import { metricsSampler } from '../../lib/metrics-sampler';
import { getDisks, getLinuxMemInfo } from './monitor.service';

/** 宿主机与进程级指标，读取本地采样器及系统状态。 */
export const INFRA_MONITOR_METRICS = [
  'cpu', 'memory', 'disk', 'swap', 'load1', 'procCpu', 'heap', 'loopLag',
  'qps', 'errorRate', 'netRxBps', 'netTxBps', 'diskReadBps', 'diskWriteBps',
] as const satisfies readonly MonitorMetric[];
type InfraMetric = (typeof INFRA_MONITOR_METRICS)[number];
type InfraMetricSnapshot = Record<InfraMetric, number | null>;
type CompleteInfraMetricSnapshot = Record<InfraMetric, number>;

export function isCompleteInfraMetricSnapshot(value: InfraMetricSnapshot): value is CompleteInfraMetricSnapshot {
  return Object.values(value).every((item) => typeof item === 'number' && Number.isFinite(item));
}

/**
 * 采集基础设施指标即时值。磁盘使用率取所有挂载点中的最大值（最易触发容量告警）。
 * 落库的 `system_metric_samples` 只有 NOT NULL 基础设施列；缺少任一依赖时保留 null，
 * 由持久化入口跳过该轮，而不是把不可用数据写成零。
 */
export async function getInfraMetricSnapshot(): Promise<InfraMetricSnapshot | null> {
  const sample = metricsSampler.getLatest();
  if (!sample) return null;
  const diskIo = metricsSampler.getDiskIo();
  const [disks, memInfo] = await Promise.all([getDisks(), getLinuxMemInfo()]);
  const disk = disks && disks.length > 0 ? Math.max(...disks.map((d) => d.usagePercent)) : null;
  const load1 = os.loadavg()[0] ?? null;
  return {
    cpu: sample.cpu,
    memory: sample.mem,
    disk,
    swap: memInfo?.swapUsagePercent ?? null,
    load1: load1 === null ? null : Math.round(load1 * 100) / 100,
    procCpu: sample.procCpu,
    heap: sample.heap,
    // 告警口径用窗口 max 而非 mean/p99：10s 窗口约 500 个采样点，一次 300ms 阻塞
    // 只占 0.2%，mean 与 p99 都会把它彻底稀释（冒烟实测 p99 无感），只有峰值能暴露
    loopLag: sample.loopLagMax,
    qps: sample.qps,
    errorRate: sample.errorRate,
    netRxBps: sample.netRxBps,
    netTxBps: sample.netTxBps,
    diskReadBps: diskIo.readBps,
    diskWriteBps: diskIo.writeBps,
  };
}
