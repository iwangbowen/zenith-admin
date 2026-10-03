import type { JobMonitorOverview, JobSourceSummary } from './contracts/job-monitor';

/** Shared by the platform collector and Demo so mirror rows cannot inflate execution totals. */
export function sumJobMonitorCounts(sources: (Pick<JobSourceSummary, 'health' | 'counts'> & { stuckOnly?: boolean })[]): JobMonitorOverview['totals'] {
  const totals = { backlog: 0, running: 0, stuck: 0, dead: 0, failed24h: 0 };
  for (const source of sources) {
    if (source.health === 'unavailable') continue;
    totals.stuck += source.counts.stuck;
    if (source.stuckOnly) continue;
    totals.backlog += source.counts.pending;
    totals.running += source.counts.running;
    totals.dead += source.counts.dead ?? 0;
    totals.failed24h += source.counts.failed24h;
  }
  return totals;
}
