import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('业务日历与进程时区隔离', () => {
  it.each(['UTC', 'America/New_York'])('上海月首不会回到上个月（进程 TZ=%s）', async (processZone) => {
    vi.stubEnv('TZ', processZone);
    vi.stubEnv('APP_TIME_ZONE', 'Asia/Shanghai');
    vi.resetModules();
    const { startOfMonth } = await import('./datetime');
    expect(startOfMonth(new Date('2026-09-30T17:30:00Z')).toISOString()).toBe('2026-09-30T16:00:00.000Z');
    expect(startOfMonth(new Date('2025-12-31T17:30:00Z')).toISOString()).toBe('2025-12-31T16:00:00.000Z');
  });

  it.each([
    { now: '2026-03-08T16:00:00Z', today: '2026-03-08T05:00:00.000Z', tomorrow: '2026-03-09T04:00:00.000Z', firstDay: '2026-03-07', axis: ['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'] },
    { now: '2026-11-01T17:00:00Z', today: '2026-11-01T04:00:00.000Z', tomorrow: '2026-11-02T05:00:00.000Z', firstDay: '2026-10-31', axis: ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'] },
  ])('纽约夏令时日界和日期轴保持自然日（$firstDay）', async ({ now, today, tomorrow, firstDay, axis }) => {
    vi.stubEnv('TZ', 'UTC');
    vi.stubEnv('APP_TIME_ZONE', 'America/New_York');
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    vi.resetModules();
    const { buildDateAxis, startOfToday, startOfDayAgo } = await import('./datetime');
    expect(startOfToday().toISOString()).toBe(today);
    expect(startOfDayAgo(-1).toISOString()).toBe(tomorrow);
    expect(buildDateAxis(firstDay, 4)).toEqual(axis);
    expect(buildDateAxis(startOfDayAgo(1), 4)).toEqual(axis);
  });
});
