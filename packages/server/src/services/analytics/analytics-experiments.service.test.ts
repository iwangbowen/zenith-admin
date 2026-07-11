
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';

const { select, insert, update, del, execute, count, findMany } = vi.hoisted(() => ({
  select: vi.fn(), insert: vi.fn(), update: vi.fn(), del: vi.fn(), execute: vi.fn(), count: vi.fn(), findMany: vi.fn(),
}));

vi.mock('../../db', () => ({
  db: { select, insert, update, delete: del, execute, $count: count, query: { analyticsExperiments: { findMany, findFirst: vi.fn() } } },
}));

vi.mock('../../lib/tenant', () => ({ currentCreateTenantId: () => null, tenantScope: () => undefined }));

const row = {
  id: 1,
  tenantId: null,
  expKey: 'checkout_test',
  name: '结算实验',
  description: null,
  status: 'draft' as const,
  trafficAllocation: 100,
  variants: [{ key: 'control', name: '对照组', weight: 50 }, { key: 'treatment', name: '实验组', weight: 50 }],
  metricEventName: 'order_submit',
  startAt: null,
  endAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

import { __resetAnalyticsExperimentCacheForTest, bucketFor, createExperiment, getAssignments, pickVariant, updateExperiment } from './analytics-experiments.service';

describe('analytics experiments service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAnalyticsExperimentCacheForTest();
  });

  it('keeps deterministic buckets and maps weight intervals', () => {
    expect(bucketFor('exp_a', 'u:1')).toBe(bucketFor('exp_a', 'u:1'));
    expect(pickVariant(row.variants, 0)).toBe('control');
    expect(pickVariant(row.variants, 49)).toBe('control');
    expect(pickVariant(row.variants, 50)).toBe('treatment');
    expect(pickVariant(row.variants, 99)).toBe('treatment');
  });

  it('excludes users outside traffic allocation', async () => {
    select.mockReturnValue({ from: () => ({ where: async () => [{ expKey: 'exp_a', trafficAllocation: 0, variants: row.variants }] }) });
    await expect(getAssignments('u:1', null)).resolves.toEqual([]);
  });

  it('maps unique conflicts to HTTP 400', async () => {
    const err = Object.assign(new Error('duplicate'), { code: '23505' });
    insert.mockReturnValue({ values: () => ({ returning: async () => { throw err; } }) });
    await expect(createExperiment({ expKey: 'dup', name: '重复实验', variants: row.variants, metricEventName: 'order_submit', trafficAllocation: 100, status: 'draft' })).rejects.toMatchObject({ status: 400 });
  });

  it('guards running experiments from variant drift', async () => {
    select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ ...row, status: 'running' }] }) }) });
    await expect(updateExperiment(1, { trafficAllocation: 80 })).rejects.toBeInstanceOf(HTTPException);
    await expect(updateExperiment(1, { variants: row.variants })).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });
});
