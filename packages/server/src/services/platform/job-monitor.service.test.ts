import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ tenantId: null as number | null, sources: [] as unknown[] }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ tenantId: state.tenantId }) }));
vi.mock('../../lib/job-monitor/registry', () => ({ listJobSources: () => state.sources, getJobSource: (key: string) => (state.sources as JobSourceRegistration[]).find(s => s.key === key) }));
vi.mock('../tasks/system-scheduler.service', () => ({
  listSystemSchedulerNodes: vi.fn(async () => ({ list: [{ nodeId: 'node', hostname: 'host', pid: 1, roles: ['worker'], version: null, lastHeartbeatAt: '2026-10-03T00:00:00Z', runningJobCount: 0, stale: false, active: true }], total: 1 })),
  listSystemSchedulerTasks: vi.fn(async () => []),
}));
import { collectJobSource, getJobMonitorOverview, listJobMonitorStuck } from './job-monitor.service';
import type { JobSourceRegistration } from '../../lib/job-monitor/registry';
const source = (collect: JobSourceRegistration['collect']): JobSourceRegistration => ({ key: 'async-task', title: 'tasks', module: 'tasks', order: 1, collect });
beforeEach(() => { state.tenantId = null; state.sources = []; });
it('isolates failed sources and excludes them from totals', async () => {
  state.sources = [source(async () => { throw new Error('offline'); }), { ...source(async () => ({ counts: { pending: 3, running: 2, stuck: 0, dead: null, failed24h: 1, succeeded24h: 2 }, oldestPendingAgeSec: 5, issues: [] })), key: 'export-job' }];
  const overview = await getJobMonitorOverview();
  expect(overview.sources[0]).toMatchObject({ health: 'unavailable', reason: 'offline' });
  expect(overview.totals).toEqual({ backlog: 3, running: 2, stuck: 0, dead: 0, failed24h: 1 });
});
it('turns a hung source into unavailable after the probe deadline', async () => {
  vi.useFakeTimers();
  try {
    const pending = collectJobSource(source(() => new Promise(() => {})));
    await vi.advanceTimersByTimeAsync(8001);
    expect(await pending).toMatchObject({ health: 'unavailable', reason: '探测超时' });
  } finally { vi.useRealTimers(); }
});
it('rejects tenant users before probing platform data', async () => {
  state.tenantId = 1;
  await expect(getJobMonitorOverview()).rejects.toMatchObject({ status: 403 });
});
it('rejects unsupported stuck lists and passes a bounded request to the source', async () => {
  state.sources = [source(async () => ({ counts: { pending: 0, running: 0, stuck: 0, dead: null, failed24h: 0, succeeded24h: 0 }, oldestPendingAgeSec: null, issues: [] }))];
  await expect(listJobMonitorStuck('async-task', 50)).rejects.toMatchObject({ status: 400 });
  const listStuck = vi.fn(async () => []);
  state.sources = [{ ...(state.sources[0] as JobSourceRegistration), listStuck }];
  expect(await listJobMonitorStuck('async-task', 20)).toEqual([]);
  expect(listStuck).toHaveBeenCalledWith(20);
  state.tenantId = 2;
  await expect(listJobMonitorStuck('async-task', 20)).rejects.toMatchObject({ status: 403 });
});
