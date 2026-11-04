/**
 * 导出中心「遵守页面筛选」回归测试。
 *
 * 扫描 countRows / streamRows 是否消费 query，并验证与列表共用的 where 构造器：
 * 有筛选时生成条件，无筛选时返回 undefined。
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

vi.mock('../../db/index', () => ({
  db: { select: vi.fn(), $count: vi.fn(), query: {}, transaction: vi.fn() },
  readSnapshot: vi.fn(),
}));
vi.mock('../redis', () => ({ default: { get: vi.fn(), set: vi.fn(), del: vi.fn(), scan: vi.fn() } }));
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../context', async (importOriginal) => ({
  ...await importOriginal<typeof import('../context')>(),
  currentUser: vi.fn(() => ({ userId: 1, username: 'admin', roles: ['admin'], tenantId: null })),
  currentUserOrNull: vi.fn(() => null),
}));

import { buildTenantsWhere } from '../../services/identity/tenants.service';
import { buildCronJobsWhere } from '../../services/tasks/cron-jobs.service';
import { buildFileStorageConfigsWhere } from '../../services/files/file-storage-configs.service';
import { buildUserFeedbacksWhere } from '../../services/platform/user-feedbacks.service';
import { matchesDepartmentFilter } from '../../services/identity/departments.service';

const dialect = new PgDialect();
const render = (condition: SQL | undefined) => (condition ? dialect.sqlToQuery(condition) : undefined);

describe('导出定义消费页面筛选', () => {
  const definitions = [
    ['identity', 'tenants'], ['tasks', 'cron-jobs'], ['identity', 'departments'],
    ['files', 'file-storage-configs'], ['identity', 'login-logs'], ['ops', 'processes'],
    ['platform', 'regions'], ['short-link', 'short-links'], ['platform', 'user-feedbacks'],
  ];

  it.each(definitions)('%s/%s：countRows / streamRows 均接收 query', async (domain, name) => {
    const source = await readFile(new URL(`../../services/${domain}/exports/${name}.ts`, import.meta.url), 'utf8');
    expect(source).toMatch(/countRows:\s*async \(query\)/);
    expect(source).toMatch(/streamRows:\s*async \(query\)/);
    expect(source).not.toMatch(/(countRows|streamRows):\s*async \(\)\s*=>/);
  });
});

describe('列表 / 导出共用的 where 构造器', () => {
  it('buildTenantsWhere：关键字 + 状态；无条件时不加 WHERE', () => {
    const q = render(buildTenantsWhere({ keyword: '华东', status: 'enabled' }));
    expect(q?.sql).toMatch(/like/i);
    expect(q?.params).toEqual(['%华东%', 'enabled']);
    expect(buildTenantsWhere({})).toBeUndefined();
  });

  it('buildCronJobsWhere：状态筛选现已同时作用于列表与导出', () => {
    const q = render(buildCronJobsWhere({ status: 'disabled' }));
    expect(q?.sql).toMatch(/"status" = \$1/);
    expect(q?.params).toEqual(['disabled']);
    expect(buildCronJobsWhere({ keyword: '  ' })).toBeUndefined();
  });

  it('buildFileStorageConfigsWhere：时间范围作用于 updatedAt，终点补到当天末尾', () => {
    const q = render(buildFileStorageConfigsWhere({ startTime: '2026-01-01', endTime: '2026-01-31' }));
    expect(q?.sql).toMatch(/"updatedAt" >= \$1 and .*"updatedAt" <= \$2/);
    // Drizzle 按列类型把 Date 序列化成 ISO 字符串；终点应落在 1 月 31 日当天末尾而非 00:00:00
    const [start, end] = q!.params.map((p) => new Date(p as string).getTime());
    expect(end - start).toBeGreaterThan(30 * 24 * 60 * 60 * 1000);
    expect(end - start).toBeLessThan(31 * 24 * 60 * 60 * 1000);
    expect(buildFileStorageConfigsWhere({})).toBeUndefined();
  });

  it('buildUserFeedbacksWhere：分类 / 状态 / 关键字', () => {
    const q = render(buildUserFeedbacksWhere({ keyword: '崩溃', category: 'bug', status: 'pending' }));
    expect(q?.params).toEqual(['%崩溃%', 'bug', 'pending']);
  });

  it('matchesDepartmentFilter：树形列表与平铺导出共用同一判定', () => {
    const node = { name: '研发中心', code: 'RD', status: 'enabled' as const };
    expect(matchesDepartmentFilter(node, { keyword: '研发' })).toBe(true);
    expect(matchesDepartmentFilter(node, { keyword: 'RD', status: 'enabled' })).toBe(true);
    expect(matchesDepartmentFilter(node, { status: 'disabled' })).toBe(false);
    expect(matchesDepartmentFilter(node, {})).toBe(true);
  });
});
