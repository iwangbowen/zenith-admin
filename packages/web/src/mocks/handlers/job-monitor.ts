import { jobMonitorContract } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { createDemoJobMonitorOverview } from '@/mocks/data/job-monitor';

export const jobMonitorHandlers = [
  mock(jobMonitorContract.overview, ({ ok }) => ok(createDemoJobMonitorOverview())),
];
