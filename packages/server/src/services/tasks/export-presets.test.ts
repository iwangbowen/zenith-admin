import { describe, expect, it } from 'vitest';
import { nextExportRun } from './export-presets.service';
describe('scheduled export cadence', () => {
  it('uses Shanghai local time with a deterministic five-field cron', () => {
    expect(nextExportRun('0 9 * * 1', new Date('2026-11-14T00:00:00Z')).toISOString()).toBe('2026-11-16T01:00:00.000Z');
  });
  it('rejects second-resolution and malformed cron schedules', () => {
    expect(() => nextExportRun('* * * * * *')).toThrow();
    expect(() => nextExportRun('not a cron')).toThrow();
    expect(() => nextExportRun('0 25 * * *')).toThrow();
  });
});
