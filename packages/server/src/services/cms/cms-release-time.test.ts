import { describe, expect, it } from 'vitest';
import { formatCmsReleaseActivationTime, resolveCmsReleaseActivationTime } from './cms-release-time';
describe('CMS release schedule zones', () => {
  it('uses the selected zone independently of the machine timezone', () => {
    expect(resolveCmsReleaseActivationTime('2026-07-01 09:00:00', 'America/New_York')?.toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(resolveCmsReleaseActivationTime('2026-07-01 09:00:00', 'Asia/Shanghai')?.toISOString()).toBe('2026-07-01T01:00:00.000Z');
  });
  it('rejects a nonexistent daylight-saving wall time', () => {
    expect(() => resolveCmsReleaseActivationTime('2026-03-08 02:30:00', 'America/New_York')).toThrow();
    expect(() => resolveCmsReleaseActivationTime('2026-02-30 09:00:00', 'Asia/Shanghai')).toThrow();
  });
  it('round trips the selected wall time for display', () => {
    const instant = resolveCmsReleaseActivationTime('2026-07-01 09:00:00', 'America/New_York');
    expect(formatCmsReleaseActivationTime(instant, 'America/New_York')).toBe('2026-07-01 09:00:00');
  });
});
