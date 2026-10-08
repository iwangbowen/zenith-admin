import { cronJobContract, systemSchedulerContract } from '@zenith/shared/platform';
import { asyncTaskContract, exportJobContract, importJobContract, taskDemoContract } from '@zenith/shared/tasks';
import { defineRouteDomain } from '../_kit';
import asyncTasksRoutes from './async-tasks';
import cronJobsRoutes from './cron-jobs';
import exportJobsRoutes from './export-jobs';
import importJobsRoutes from './import-jobs';
import systemSchedulerRoutes from './system-scheduler';
import taskDemoRoutes from './task-demo';

export default defineRouteDomain({
  name: 'tasks',
  licensing: { core: '统一任务、调度与导入导出是基础能力' },
  mounts: () => [
    [exportJobContract.basePath, exportJobsRoutes],
    [importJobContract.basePath, importJobsRoutes],
    [asyncTaskContract.basePath, asyncTasksRoutes],
    [systemSchedulerContract.basePath, systemSchedulerRoutes],
    [cronJobContract.basePath, cronJobsRoutes],
    [taskDemoContract.basePath, taskDemoRoutes],
  ],
});