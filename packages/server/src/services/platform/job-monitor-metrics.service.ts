import { listJobSources } from '../../lib/job-monitor/registry';
import { section } from '../../lib/probe-section';
import logger from '../../lib/logger';

export type JobMonitorMetricKey = 'jobsBacklog' | 'jobsStuck' | 'jobsDead' | 'jobsFailed1h';
export type JobMonitorAlertMetrics = Record<JobMonitorMetricKey, number | null>;

/** Missing observations must not resolve a live alert or fabricate a zero trend. */
export async function getJobMonitorAlertMetrics(): Promise<JobMonitorAlertMetrics> {
  const sources = listJobSources();
  const results = await Promise.all(sources.map(source => section(source.collect)));
  if (sources.length === 0 || results.some(result => !result.available)) {
    logger.warn('[job-monitor] 作业指标采集不完整，跳过本次告警评估', { unavailable: results.map((r, i) => r.available ? null : sources[i].key).filter(Boolean) });
    return { jobsBacklog: null, jobsStuck: null, jobsDead: null, jobsFailed1h: null };
  }
  const totals = { jobsBacklog: 0, jobsStuck: 0, jobsDead: 0, jobsFailed1h: 0 };
  for (const result of results) {
    if (!result.data) continue;
    totals.jobsBacklog += result.data.counts.pending;
    totals.jobsStuck += result.data.counts.stuck;
    totals.jobsDead += result.data.counts.dead ?? 0;
    totals.jobsFailed1h += result.data.failed1h ?? 0;
  }
  return totals;
}
