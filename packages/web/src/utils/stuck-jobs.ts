import type { DirectorySyncRun } from '@zenith/shared/identity';
import type { DbBackup } from '@zenith/shared/ops';
import { JOB_MONITOR_BACKUP_PENDING_STUCK_MS, JOB_MONITOR_BACKUP_STUCK_MS, JOB_MONITOR_DIRECTORY_STUCK_MS } from '@zenith/shared/platform';
import { parseDateTimeParam } from '@/utils/date';

function olderThan(value: string | null, thresholdMs: number, nowMs: number): boolean {
  const time = parseDateTimeParam(value)?.getTime();
  return time !== undefined && Number.isFinite(time) && time < nowMs - thresholdMs;
}

export function isDirectorySyncRunStuck(run: Pick<DirectorySyncRun, 'status' | 'startedAt'>, nowMs = Date.now()): boolean {
  return run.status === 'running' && olderThan(run.startedAt, JOB_MONITOR_DIRECTORY_STUCK_MS, nowMs);
}

export function isDbBackupStuck(backup: Pick<DbBackup, 'status' | 'startedAt' | 'createdAt'>, nowMs = Date.now()): boolean {
  return (backup.status === 'running' && olderThan(backup.startedAt ?? backup.createdAt, JOB_MONITOR_BACKUP_STUCK_MS, nowMs))
    || (backup.status === 'pending' && olderThan(backup.createdAt, JOB_MONITOR_BACKUP_PENDING_STUCK_MS, nowMs));
}
