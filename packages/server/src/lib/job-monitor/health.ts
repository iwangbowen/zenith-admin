import { JOB_MONITOR_DEFAULT_THRESHOLDS, type JobHealthLevel, type JobMonitorThresholds, type JobMonitorOverview } from '@zenith/shared/platform';
import type { JobSourceRawSummary } from './registry';

const rank: Record<JobHealthLevel, number> = { ok: 0, unavailable: 1, warn: 2, critical: 3 };
export function deriveSourceHealth(raw: JobSourceRawSummary, overrides: Partial<JobMonitorThresholds> = {}): JobHealthLevel {
  const t = { ...JOB_MONITOR_DEFAULT_THRESHOLDS, ...overrides };
  let health: JobHealthLevel = 'ok';
  const raise = (level: JobHealthLevel) => { if (rank[level] > rank[health]) health = level; };
  raw.issues.forEach(issue => raise(issue.level));
  if (raw.counts.stuck > 0) raise(t.stuckLevel);
  if ((raw.counts.dead ?? 0) > 0) raise(t.deadLevel);
  if (raw.oldestPendingAgeSec != null) {
    if (raw.oldestPendingAgeSec > t.oldestPendingCriticalSec) raise('critical');
    else if (raw.oldestPendingAgeSec > t.oldestPendingWarnSec) raise('warn');
  }
  const sample = raw.counts.failed24h + raw.counts.succeeded24h;
  if (sample >= t.failureRateMinSample) {
    const rate = raw.counts.failed24h / sample;
    if (rate > t.failureRateCritical) raise('critical');
    else if (rate > t.failureRateWarn) raise('warn');
  }
  return health;
}
export function deriveOverallHealth(sources: Pick<JobMonitorOverview['sources'][number], 'health'>[], workers: JobMonitorOverview['workers']): JobHealthLevel {
  let health: JobHealthLevel = workers.available ? 'ok' : 'unavailable';
  if (workers.data?.workerRoleActive === 0) health = 'critical';
  else if ((workers.data?.stale ?? 0) > 0) health = 'warn';
  for (const source of sources) if (rank[source.health] > rank[health]) health = source.health;
  return health;
}
