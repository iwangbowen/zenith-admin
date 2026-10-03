import { describe, expect, it } from 'vitest';
import { formatDateTime } from './date';
import { isDbBackupStuck, isDirectorySyncRunStuck } from './stuck-jobs';

const now = new Date('2026-10-03T12:00:00').getTime();
const before = (ms: number) => formatDateTime(new Date(now - ms));

describe('manual job closure eligibility', () => {
  it('requires a still-running directory sync beyond one hour', () => {
    expect(isDirectorySyncRunStuck({ status: 'running', startedAt: before(3600_000) }, now)).toBe(false);
    expect(isDirectorySyncRunStuck({ status: 'running', startedAt: before(3601_000) }, now)).toBe(true);
    expect(isDirectorySyncRunStuck({ status: 'success', startedAt: before(7200_000) }, now)).toBe(false);
    expect(isDirectorySyncRunStuck({ status: 'running', startedAt: 'invalid' }, now)).toBe(false);
  });

  it('uses the backup start time with the server creation-time fallback', () => {
    expect(isDbBackupStuck({ status: 'running', startedAt: before(7200_000), createdAt: before(10800_000) }, now)).toBe(false);
    expect(isDbBackupStuck({ status: 'running', startedAt: before(7201_000), createdAt: before(10800_000) }, now)).toBe(true);
    expect(isDbBackupStuck({ status: 'running', startedAt: null, createdAt: before(7201_000) }, now)).toBe(true);
    expect(isDbBackupStuck({ status: 'success', startedAt: before(10800_000), createdAt: before(10800_000) }, now)).toBe(false);
  });

  it('requires pending backups to exceed ten minutes regardless of a stray start time', () => {
    expect(isDbBackupStuck({ status: 'pending', startedAt: before(7201_000), createdAt: before(600_000) }, now)).toBe(false);
    expect(isDbBackupStuck({ status: 'pending', startedAt: null, createdAt: before(601_000) }, now)).toBe(true);
  });
});
