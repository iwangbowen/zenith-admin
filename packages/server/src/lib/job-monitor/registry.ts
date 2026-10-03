import type { JobSourceKey, JobSourceSummary, JobMonitorThresholds, JobDrillDown, JobStuckItem, JobSourceCategory } from '@zenith/shared/platform';

export type JobSourceRawSummary = Pick<JobSourceSummary, 'counts' | 'oldestPendingAgeSec' | 'issues' | 'breakdown'> & { failed1h?: number };
export interface JobSourceRegistration {
  key: JobSourceKey; title: string; module: string; order: number;
  category?: JobSourceCategory;
  totalsMode?: 'full' | 'stuck-only';
  drillDown?: JobDrillDown;
  thresholds?: Partial<JobMonitorThresholds>;
  collect(): Promise<JobSourceRawSummary>;
  listStuck?(limit: number): Promise<JobStuckItem[]>;
}
const sources = new Map<JobSourceKey, JobSourceRegistration>();
export function registerJobSource(source: JobSourceRegistration) {
  if (sources.has(source.key)) throw new Error(`重复作业源: ${source.key}`);
  sources.set(source.key, source);
}
export function getJobSource(key: JobSourceKey) { return sources.get(key); }
export function listJobSources() { return [...sources.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)); }
