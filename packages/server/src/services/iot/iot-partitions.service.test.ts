import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, getPolicyRetentionDays } = vi.hoisted(() => ({
  execute: vi.fn(),
  getPolicyRetentionDays: vi.fn(),
}));

vi.mock('../../db', () => ({ db: { execute } }));
vi.mock('../../lib/retention/runner', () => ({ getPolicyRetentionDays }));
vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

import {
  dropExpiredIotTelemetryPartitions, ensureIotTelemetryPartitionsFor, iotTelemetryPartitionName,
  isMissingIotTelemetryPartitionError, minAcceptableIotReportedAt, parsePartitionBound, resetIotPartitionCache,
  utcDayStart, utcDaysBetween,
} from './iot-partitions.service';

/** 取出 db.execute 收到的 SQL 文本（drizzle sql 对象或 sql.raw） */
function sqlText(call: unknown[]): string {
  const q = call[0] as { queryChunks?: unknown[] };
  const chunks = q.queryChunks ?? [];
  return chunks.map((c) => {
    if (typeof c === 'string') return c;
    const raw = c as { value?: string[] | string };
    if (Array.isArray(raw.value)) return raw.value.join('');
    if (typeof raw.value === 'string') return raw.value;
    return '?';
  }).join('');
}

beforeEach(() => {
  vi.clearAllMocks();
  resetIotPartitionCache();
});

describe('分区命名与边界', () => {
  it('按 UTC 日命名，边界不受本地时区影响', () => {
    // 2026-09-03T23:30Z：UTC 仍是 3 日，东八区已是 4 日
    const at = new Date('2026-09-03T23:30:00Z');
    expect(iotTelemetryPartitionName(at)).toBe('iot_telemetry_p20260903');
    expect(utcDayStart(at).toISOString()).toBe('2026-09-03T00:00:00.000Z');
  });

  it('utcDaysBetween 覆盖闭区间内每个 UTC 日', () => {
    const days = utcDaysBetween(new Date('2026-09-01T10:00:00Z'), new Date('2026-09-03T01:00:00Z'));
    expect(days.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  it('解析 relpartbound 表达式（偏移随会话时区渲染）', () => {
    for (const expr of [
      "FOR VALUES FROM ('2026-09-03 00:00:00+00') TO ('2026-09-04 00:00:00+00')",
      "FOR VALUES FROM ('2026-09-03 08:00:00+08') TO ('2026-09-04 08:00:00+08')",
      "FOR VALUES FROM ('2026-09-03 05:30:00+05:30') TO ('2026-09-04 05:30:00+05:30')",
    ]) {
      const bound = parsePartitionBound(expr);
      expect(bound?.from.toISOString()).toBe('2026-09-03T00:00:00.000Z');
      expect(bound?.to.toISOString()).toBe('2026-09-04T00:00:00.000Z');
    }
    expect(parsePartitionBound('DEFAULT')).toBeNull();
  });

  it('识别「无分区」写入错误（含 drizzle 包装层）', () => {
    expect(isMissingIotTelemetryPartitionError({ code: '23514', message: 'no partition of relation "iot_telemetry" found for row' })).toBe(true);
    // DrizzleQueryError：外层 message 只有 Failed query，原错误在 cause
    expect(isMissingIotTelemetryPartitionError({
      message: 'Failed query: insert into "iot_telemetry" ...',
      cause: { code: '23514', message: 'no partition of relation "iot_telemetry" found for row' },
    })).toBe(true);
    expect(isMissingIotTelemetryPartitionError({ code: '23514', message: 'check constraint violated' })).toBe(false);
    expect(isMissingIotTelemetryPartitionError({ code: '23505', message: 'no partition of relation' })).toBe(false);
    expect(isMissingIotTelemetryPartitionError(null)).toBe(false);
  });
});

describe('ensureIotTelemetryPartitionsFor', () => {
  it('同一 UTC 日去重，缺失时建表，已存在只登记缓存', async () => {
    // 第一次探测：不存在 → 建表；第二天探测：已存在
    execute
      .mockResolvedValueOnce([])          // exists? day1 → no
      .mockResolvedValueOnce([])          // create day1
      .mockResolvedValueOnce([{ 1: 1 }]); // exists? day2 → yes
    const created = await ensureIotTelemetryPartitionsFor([
      new Date('2026-09-03T01:00:00Z'), new Date('2026-09-03T20:00:00Z'), new Date('2026-09-04T00:00:00Z'),
    ]);
    expect(created).toBe(1);
    expect(execute).toHaveBeenCalledTimes(3);
    const ddl = sqlText(execute.mock.calls[1]);
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "iot_telemetry_p20260903" PARTITION OF "iot_telemetry"');
    expect(ddl).toContain("FROM ('2026-09-03 00:00:00+00') TO ('2026-09-04 00:00:00+00')");

    // 已确认的分区不再发 DDL
    execute.mockClear();
    await ensureIotTelemetryPartitionsFor([new Date('2026-09-03T12:00:00Z')]);
    expect(execute).not.toHaveBeenCalled();

    // recheck 绕过缓存重新核对
    execute.mockResolvedValueOnce([{ 1: 1 }]);
    await ensureIotTelemetryPartitionsFor([new Date('2026-09-03T12:00:00Z')], { recheck: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('并发建同一分区撞 42P07 视为已存在', async () => {
    execute
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(Object.assign(new Error('relation already exists'), { code: '42P07' }));
    await expect(ensureIotTelemetryPartitionsFor([new Date('2026-09-05T00:00:00Z')])).resolves.toBe(0);
  });
});

describe('dropExpiredIotTelemetryPartitions', () => {
  it('只 DROP 上界不晚于截止时刻的分区，并返回其行数之和', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T10:00:00Z'));
    try {
      execute
        .mockResolvedValueOnce([
          { name: 'iot_telemetry_p20260801', bound: "FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-08-02 00:00:00+00')" },
          { name: 'iot_telemetry_p20260804', bound: "FOR VALUES FROM ('2026-08-04 00:00:00+00') TO ('2026-08-05 00:00:00+00')" },
          { name: 'iot_telemetry_p20260903', bound: "FOR VALUES FROM ('2026-09-03 00:00:00+00') TO ('2026-09-04 00:00:00+00')" },
        ])
        .mockResolvedValueOnce([{ cnt: 1200 }]) // count p20260801
        .mockResolvedValueOnce([]);             // drop p20260801
      // cutoff = 2026-08-04T10:00Z：p20260801 上界 08-02 ≤ cutoff → DROP；p20260804 上界 08-05 > cutoff → 保留
      const deleted = await dropExpiredIotTelemetryPartitions(30);
      expect(deleted).toBe(1200);
      const dropped = execute.mock.calls.map(sqlText).filter((s) => s.startsWith('DROP TABLE'));
      expect(dropped).toEqual(['DROP TABLE IF EXISTS "iot_telemetry_p20260801"']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('minAcceptableIotReportedAt', () => {
  it('按保留天数给出回填下限，保留关闭时放宽到 365 天', async () => {
    const now = new Date('2026-09-03T00:00:00Z');
    getPolicyRetentionDays.mockResolvedValueOnce(30);
    expect((await minAcceptableIotReportedAt(now)).toISOString()).toBe('2026-08-04T00:00:00.000Z');
    resetIotPartitionCache();
    getPolicyRetentionDays.mockResolvedValueOnce(0);
    expect((await minAcceptableIotReportedAt(now)).toISOString()).toBe('2025-09-03T00:00:00.000Z');
  });

  it('保留天数缓存 5 分钟内不重复查库', async () => {
    getPolicyRetentionDays.mockResolvedValue(7);
    await minAcceptableIotReportedAt();
    await minAcceptableIotReportedAt();
    expect(getPolicyRetentionDays).toHaveBeenCalledTimes(1);
  });
});
