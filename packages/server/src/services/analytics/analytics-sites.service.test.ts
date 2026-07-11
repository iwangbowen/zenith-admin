
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';

const { select, insert, update, del, count, findMany, getSiteQuotaUsage } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
  getSiteQuotaUsage: vi.fn(async (ids: number[]) => new Map(ids.map((id) => [id, 0]))),
}));

vi.mock('../../db', () => ({
  db: { select, insert, update, delete: del, $count: count, query: { analyticsSites: { findMany } } },
}));

vi.mock('../../lib/tenant', () => ({
  currentCreateTenantId: () => 11,
  tenantScope: () => undefined,
}));

vi.mock('./analytics-quota.service', () => ({
  getSiteQuotaUsage,
}));

const row = {
  id: 1,
  tenantId: 11,
  siteKey: 'zk_existing',
  name: '站点',
  appId: 'admin',
  allowedOrigins: null,
  dailyEventQuota: null,
  status: 'enabled' as const,
  remark: null,
  createdBy: null,
  updatedBy: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

import { __resetAnalyticsSiteCacheForTest, createSite, generateSiteKey, listSites, resolveSiteByKey } from './analytics-sites.service';

describe('analytics sites service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAnalyticsSiteCacheForTest();
  });

  it('generates zk-prefixed site keys with 32 hex chars', () => {
    expect(generateSiteKey()).toMatch(/^zk_[0-9a-f]{32}$/);
  });

  it('creates a site with generated key and current tenant', async () => {
    insert.mockReturnValue({ values: vi.fn((values) => ({ returning: async () => [{ ...row, ...values }] })) });
    const created = await createSite({ name: '新站点', appId: 'member', status: 'enabled' });
    expect(created.siteKey).toMatch(/^zk_[0-9a-f]{32}$/);
    expect(created.tenantId).toBe(11);
    expect(created.appId).toBe('member');
  });

  it('maps unique conflicts to HTTP 400', async () => {
    const err = Object.assign(new Error('duplicate'), { code: '23505' });
    insert.mockReturnValue({ values: () => ({ returning: async () => { throw err; } }) });
    await expect(createSite({ name: '重复', appId: 'admin' })).rejects.toBeInstanceOf(HTTPException);
    await expect(createSite({ name: '重复', appId: 'admin' })).rejects.toMatchObject({ status: 400 });
  });

  it('caches resolveSiteByKey results and filters disabled rows in SQL', async () => {
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: 2, tenantId: 22, appId: 'member', status: 'enabled', allowedOrigins: [], dailyEventQuota: 1000 }],
        }),
      }),
    });
    await expect(resolveSiteByKey('zk_cache')).resolves.toMatchObject({ id: 2, tenantId: 22, appId: 'member' });
    await expect(resolveSiteByKey('zk_cache')).resolves.toMatchObject({ id: 2, tenantId: 22, appId: 'member' });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('returns null for disabled or missing site key rows', async () => {
    select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
    await expect(resolveSiteByKey('zk_disabled')).resolves.toBeNull();
  });

  it('lists sites with tenant scope and paginated count in parallel', async () => {
    findMany.mockResolvedValue([{ ...row, tenant: { name: '租户A' } }]);
    count.mockResolvedValue(1);
    getSiteQuotaUsage.mockResolvedValue(new Map([[1, 12]]));
    await expect(listSites({ page: 1, pageSize: 20, name: '站点' })).resolves.toMatchObject({ total: 1, list: [{ tenantName: '租户A', todayUsage: 12 }] });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledTimes(1);
  });
});
