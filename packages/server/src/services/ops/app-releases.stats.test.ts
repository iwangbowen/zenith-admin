import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
// 首次模块图转换在测试装配阶段完成；各用例再重载以选择业务时区。
import './app-releases.service';

const { select, countActiveDevices, getDeviceVersionDistribution } = vi.hoisted(() => ({
  select: vi.fn(), countActiveDevices: vi.fn(), getDeviceVersionDistribution: vi.fn(),
}));
vi.mock('../../db', () => ({ db: { select } }));
vi.mock('../../lib/context', () => ({ currentUser: vi.fn() }));
vi.mock('../../lib/logger', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../files/files.service', () => ({ deleteManagedFile: vi.fn(), saveGeneratedManagedFile: vi.fn() }));
vi.mock('../files/upload-bindings.service', () => ({ bindUploadSession: vi.fn(), requireUploadBinding: vi.fn() }));
vi.mock('../files/upload-sessions.service', () => ({ abortChunkUpload: vi.fn(), completeChunkUpload: vi.fn(), getUploadStatus: vi.fn(), initChunkUpload: vi.fn(), uploadChunk: vi.fn() }));
vi.mock('./client-devices.service', () => ({ countActiveDevices, getDeviceVersionDistribution, upsertDeviceHeartbeat: vi.fn() }));

const dialect = new PgDialect({ casing: 'snake_case' });

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('TZ', 'UTC');
  vi.stubEnv('APP_TIME_ZONE', 'Asia/Shanghai');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T16:30:00Z'));
  countActiveDevices.mockResolvedValue(2);
  getDeviceVersionDistribution.mockResolvedValue([{ version: '1.0.0', devices: 2 }]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function mockStatsQuery(instants: string[], timeZone: string) {
  const windows: string[] = [];
  select.mockImplementation((fields?: Record<string, SQL>) => {
    let condition: SQL;
    const counts = () => {
      // 应用存在性查询，无时间窗口。
      if (!fields) return [{ id: 42 }];
      const rendered = dialect.sqlToQuery(condition);
      const since = String(rendered.params.find((param) => typeof param === 'string' && /^\d{4}-/.test(param)));
      windows.push(since);
      const dates = instants.filter((at) => Date.parse(at) >= Date.parse(since));
      if (fields.platform) return [{ platform: 'windows', cnt: dates.length }];
      if (!fields.date) return [{ eventType: 'check', cnt: dates.length }];
      expect(dialect.sqlToQuery(fields.date).sql).toContain(`timezone('${timeZone}',`);
      const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
      const grouped = new Map<string, number>();
      for (const at of dates) {
        const key = format.format(new Date(at));
        grouped.set(key, (grouped.get(key) ?? 0) + 1);
      }
      return [...grouped].map(([date, cnt]) => ({ date, eventType: 'check', cnt }));
    };
    const query = {
      from: () => query,
      where: (where: SQL) => { condition = where; return query; },
      groupBy: () => query,
      limit: () => query,
      then: (resolve: (value: object[]) => unknown) => Promise.resolve(counts()).then(resolve),
    };
    return query;
  });
  return windows;
}

describe('app release statistics business-day window', () => {
  it('uses the same complete natural days for events, device activity and the trend axis', async () => {
    const windows = mockStatsQuery(['2026-09-28T15:59:59Z', '2026-09-28T16:00:00Z', '2026-09-30T16:10:00Z'], 'Asia/Shanghai');
    const { getAppReleaseStats } = await import('./app-releases.service');
    const result = await getAppReleaseStats(42, 3);
    expect(windows).toEqual(Array(3).fill('2026-09-28T16:00:00.000Z'));
    expect(countActiveDevices).toHaveBeenCalledWith(42, new Date('2026-09-28T16:00:00Z'));
    expect(getDeviceVersionDistribution).toHaveBeenCalledWith(42, new Date('2026-09-28T16:00:00Z'));
    expect(result.totals).toMatchObject({ checks: 2, devices: 2 });
    expect(result.trend.map((day) => [day.date, day.checks])).toEqual([
      ['2026-09-29', 1], ['2026-09-30', 0], ['2026-10-01', 1],
    ]);
  });

  it('starts a one-day report at business midnight and includes events earlier than the request clock time', async () => {
    const windows = mockStatsQuery(['2026-09-30T15:59:59Z', '2026-09-30T16:00:00Z'], 'Asia/Shanghai');
    const { getAppReleaseStats } = await import('./app-releases.service');
    const result = await getAppReleaseStats(42, 1);
    expect(windows).toEqual(Array(3).fill('2026-09-30T16:00:00.000Z'));
    expect(result.totals.checks).toBe(1);
    expect(result.trend).toEqual([{ date: '2026-10-01', checks: 1, downloads: 0, installSuccess: 0, installFail: 0 }]);
  });
});
