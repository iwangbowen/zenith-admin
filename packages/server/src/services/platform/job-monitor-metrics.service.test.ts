import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ sources: [] as unknown[] }));
vi.mock('../../lib/job-monitor/registry', () => ({ listJobSources: () => state.sources }));
vi.mock('../../lib/logger', () => ({ default: { warn: vi.fn() } }));
import { getJobMonitorAlertMetrics } from './job-monitor-metrics.service';
beforeEach(() => { state.sources = []; });
it('aggregates the same raw observations without repeating failed24h as failed1h', async () => {
  state.sources = [{ collect: async () => ({ counts: { pending: 2, stuck: 1, dead: 3, failed24h: 9 }, failed1h: 4 }) }];
  expect(await getJobMonitorAlertMetrics()).toEqual({ jobsBacklog: 2, jobsStuck: 1, jobsDead: 3, jobsFailed1h: 4 });
});
it('marks incomplete samples missing so active alerts cannot falsely recover', async () => {
  state.sources = [{ key: 'failed', collect: async () => { throw new Error('offline'); } }];
  expect(await getJobMonitorAlertMetrics()).toEqual({ jobsBacklog: null, jobsStuck: null, jobsDead: null, jobsFailed1h: null });
});
it('includes only stuck counts from sources whose executor is already monitored', async () => {
  state.sources = [{ totalsMode: 'stuck-only', collect: async () => ({ counts: { pending: 20, stuck: 2, dead: 3 }, failed1h: 4 }) }];
  expect(await getJobMonitorAlertMetrics()).toEqual({ jobsBacklog: 0, jobsStuck: 2, jobsDead: 0, jobsFailed1h: 0 });
});
