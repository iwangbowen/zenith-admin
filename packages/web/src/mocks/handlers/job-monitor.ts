import { jobMonitorContract } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { createDemoJobMonitorOverview, createDemoStuckJobs } from '@/mocks/data/job-monitor';

export const jobMonitorHandlers = [
  mock(jobMonitorContract.overview, ({ ok }) => ok(createDemoJobMonitorOverview())),
  mock(jobMonitorContract.stuck, ({ ok, params, query }) => ok(createDemoStuckJobs(params.key).slice(0, query.limit))),
];
