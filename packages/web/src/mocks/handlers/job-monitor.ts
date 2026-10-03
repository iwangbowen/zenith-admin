import { jobMonitorContract } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { createJobMonitorDemoTask } from '@/mocks/data/job-monitor-task';
import { mockAsyncTasks } from './async-tasks';
import { createDemoJobMonitorOverview, createDemoJobMonitorTrend, createDemoStuckJobs } from '@/mocks/data/job-monitor';

function ensureMonitorDemoTask() {
  if (!mockAsyncTasks.some(task => task.id === 731)) mockAsyncTasks.push(createJobMonitorDemoTask());
}
export const jobMonitorHandlers = [
  mock(jobMonitorContract.overview, ({ ok }) => { ensureMonitorDemoTask(); return ok(createDemoJobMonitorOverview()); }),
  mock(jobMonitorContract.stuck, ({ ok, params, query }) => { ensureMonitorDemoTask(); return ok(createDemoStuckJobs(params.key).slice(0, query.limit)); }),
  mock(jobMonitorContract.trend, ({ ok, query }) => ok(createDemoJobMonitorTrend(query.range))),
];
