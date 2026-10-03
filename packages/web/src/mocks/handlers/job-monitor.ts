import { jobMonitorContract } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { createDemoJobMonitorOverview, createDemoJobMonitorTrend, createDemoStuckJobs } from '@/mocks/data/job-monitor';

export const jobMonitorHandlers = [
  mock(jobMonitorContract.overview, ({ ok }) => ok(createDemoJobMonitorOverview())),
  mock(jobMonitorContract.stuck, ({ ok, params, query }) => ok(createDemoStuckJobs(params.key).slice(0, query.limit))),
  mock(jobMonitorContract.trend, ({ ok, query }) => ok(createDemoJobMonitorTrend(query.range))),
];
