import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const { execute, select, update, insert, deleteFrom } = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  deleteFrom: vi.fn(),
}));

vi.mock('../../db', () => ({
  db: { execute, select, update, insert, delete: deleteFrom },
}));

import { previewPolicy, runPolicy } from './runner';
import { findPolicy } from './policies';

/** 构造 `db.select().from().where().limit()` 链，返回给定配置行 */
function mockConfig(row: Record<string, unknown> | undefined) {
  select.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: async () => (row ? [row] : []),
      }),
    }),
  });
}

const BASE_CONFIG = {
  policyKey: 'operation_logs',
  enabled: true,
  retentionDays: 180,
  batchSize: 5000,
};

beforeEach(() => {
  vi.clearAllMocks();
  update.mockReturnValue({ set: () => ({ where: async () => undefined }) });
});

describe('runPolicy', () => {
  it('未知策略直接返回 0，不触碰数据库', async () => {
    await expect(runPolicy('not_a_policy')).resolves.toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('策略被停用时跳过执行', async () => {
    mockConfig({ ...BASE_CONFIG, enabled: false });
    await expect(runPolicy('operation_logs')).resolves.toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('保留天数为 0 表示不清理', async () => {
    mockConfig({ ...BASE_CONFIG, retentionDays: 0 });
    await expect(runPolicy('operation_logs')).resolves.toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('删满一批后继续下一批，直到不足一批为止', async () => {
    mockConfig({ ...BASE_CONFIG, batchSize: 100 });
    execute
      .mockResolvedValueOnce({ rowCount: 100 })
      .mockResolvedValueOnce({ rowCount: 100 })
      .mockResolvedValueOnce({ rowCount: 7 });
    await expect(runPolicy('operation_logs')).resolves.toBe(207);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('首批未满即停止，不做多余查询', async () => {
    mockConfig({ ...BASE_CONFIG, batchSize: 100 });
    execute.mockResolvedValueOnce({ rowCount: 3 });
    await expect(runPolicy('operation_logs')).resolves.toBe(3);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('执行结果写回 lastRunAt 与 lastDeleted', async () => {
    mockConfig({ ...BASE_CONFIG, batchSize: 100 });
    execute.mockResolvedValueOnce({ rowCount: 12 });
    const set = vi.fn(() => ({ where: async () => undefined }));
    update.mockReturnValue({ set });
    await runPolicy('operation_logs');
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ lastDeleted: 12 }));
  });

  it('显式传入天数时覆盖库中配置，且停用状态不阻断手动清理', async () => {
    mockConfig({ ...BASE_CONFIG, enabled: false, batchSize: 100 });
    execute.mockResolvedValueOnce({ rowCount: 5 });
    await expect(runPolicy('operation_logs', { days: 7 })).resolves.toBe(5);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('previewPolicy', () => {
  it('保留天数为 0 时返回空预览', async () => {
    mockConfig({ ...BASE_CONFIG, retentionDays: 0 });
    await expect(previewPolicy('operation_logs')).resolves.toEqual({
      key: 'operation_logs',
      pending: 0,
      cutoff: null,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('返回待清理行数与裁剪时间点', async () => {
    mockConfig(BASE_CONFIG);
    execute.mockResolvedValueOnce([{ pending: 42 }]);
    const result = await previewPolicy('operation_logs');
    expect(result.pending).toBe(42);
    expect(result.cutoff).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('API access log retention', () => {
  it('registers one global 90-day source-data policy, separate from operation audit', () => {
    expect(findPolicy('api_access_logs')).toMatchObject({ key: 'api_access_logs', title: 'API 访问日志', tableName: 'api_access_logs', timeColumn: 'created_at', defaultDays: 90 });
    expect(findPolicy('api_access_logs')?.perTenant).toBeUndefined();
    expect(findPolicy('operation_logs')?.defaultDays).toBe(180);
  });

  it.each([{ enabled: false, retentionDays: 90 }, { enabled: true, retentionDays: 0 }])('does not delete while disabled or permanently retained: %j', async (policy) => {
    mockConfig({ ...BASE_CONFIG, policyKey: 'api_access_logs', ...policy });
    await expect(runPolicy('api_access_logs')).resolves.toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('deletes only rows strictly older than the rolling cutoff, in bounded batches', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-03T08:00:00Z'));
    try {
      mockConfig({ ...BASE_CONFIG, policyKey: 'api_access_logs', retentionDays: 90, batchSize: 100 });
      execute.mockResolvedValueOnce({ rowCount: 100 }).mockResolvedValueOnce({ rowCount: 9 });
      await expect(runPolicy('api_access_logs')).resolves.toBe(109);
      expect(execute).toHaveBeenCalledTimes(2);
      const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
      expect(compiled.sql).toContain('DELETE FROM "api_access_logs"');
      expect(compiled.sql).toContain('"created_at" <');
      expect(compiled.sql).toContain('::timestamptz');
      expect(compiled.params).toEqual([new Date(Date.now() - 90 * 86_400_000).toISOString(), 100]);
    } finally {
      vi.useRealTimers();
    }
  });
});
