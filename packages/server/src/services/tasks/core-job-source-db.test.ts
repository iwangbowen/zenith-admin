import { describe, expect, it } from 'vitest';
import { jobSourceCountsSchema, jobStuckItemSchema } from '@zenith/shared/platform';
import { getAsyncTaskHealth, listStuckAsyncTasks } from './async-tasks.service';
import { getExportJobHealth, listStuckExportJobs } from './export-jobs.service';
import { getSchedulerRunHealth, listOverdueSchedulerRuns } from './system-scheduler.service';
import { getCronJobHealth, listStuckCronRuns } from './cron-jobs.service';
import { getWorkflowJobHealth, listStuckWorkflowJobs } from '../workflow/workflow-jobs.service';
import { getDirectorySyncHealth, listStuckDirectorySyncRuns } from '../identity/directory-sync.service';
import { getDbBackupHealth, listStuckDbBackups } from '../ops/db-admin-backups.service';

describe.skipIf(process.env.RUN_JOB_MONITOR_DB_TESTS !== '1')('core collectors on the local database without writes', () => {
  it('executes aggregate and stuck queries through the real timestamp encoder', async () => {
    const sources = [
      [getAsyncTaskHealth, listStuckAsyncTasks], [getExportJobHealth, listStuckExportJobs],
      [getSchedulerRunHealth, listOverdueSchedulerRuns], [getCronJobHealth, listStuckCronRuns],
      [getWorkflowJobHealth, listStuckWorkflowJobs], [getDirectorySyncHealth, listStuckDirectorySyncRuns],
      [getDbBackupHealth, listStuckDbBackups],
    ] as const;
    for (const [collect, list] of sources) {
      const summary = await collect();
      expect(jobSourceCountsSchema.safeParse(summary.counts).success).toBe(true);
      const items = await list(5);
      expect(items.length).toBeLessThanOrEqual(5);
      for (const item of items) expect(jobStuckItemSchema.safeParse(item).success).toBe(true);
    }
  }, 90_000);
});
