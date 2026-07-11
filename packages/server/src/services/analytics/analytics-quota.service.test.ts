import { beforeEach, describe, expect, it, vi } from 'vitest';

const { incrby, expire, decrby, mget } = vi.hoisted(() => ({
  incrby: vi.fn(),
  expire: vi.fn(),
  decrby: vi.fn(),
  mget: vi.fn(),
}));

vi.mock('../../lib/redis', () => ({
  default: { incrby, expire, decrby, mget },
}));

vi.mock('../../config', () => ({
  config: { redis: { keyPrefix: 'zenith:' } },
}));

vi.mock('../../lib/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { checkAndConsumeSiteQuota, getSiteQuotaUsage, refundSiteQuota } from './analytics-quota.service';

describe('analytics quota service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('consumes quota when under limit and sets expiry on first increment', async () => {
    incrby.mockResolvedValue(3);
    await expect(checkAndConsumeSiteQuota(1, 10, 3)).resolves.toEqual({ allowed: true, current: 3 });
    expect(expire).toHaveBeenCalledTimes(1);
    expect(decrby).not.toHaveBeenCalled();
  });

  it('allows a batch that exactly reaches the quota', async () => {
    incrby.mockResolvedValue(10);
    await expect(checkAndConsumeSiteQuota(1, 10, 2)).resolves.toEqual({ allowed: true, current: 10 });
    expect(decrby).not.toHaveBeenCalled();
  });

  it('rolls back consumption when quota is exceeded', async () => {
    incrby.mockResolvedValue(12);
    decrby.mockResolvedValue(9);
    await expect(checkAndConsumeSiteQuota(1, 10, 3)).resolves.toEqual({ allowed: false, current: 9 });
    expect(decrby).toHaveBeenCalledWith(expect.stringContaining('zenith:analytics:quota:1:'), 3);
  });

  it('fails open when Redis is unavailable', async () => {
    incrby.mockRejectedValue(new Error('redis down'));
    await expect(checkAndConsumeSiteQuota(1, 10, 3)).resolves.toEqual({ allowed: true, current: 0 });
  });

  it('reads today usage for multiple sites', async () => {
    mget.mockResolvedValue(['5', null, '20']);
    await expect(getSiteQuotaUsage([1, 2, 3])).resolves.toEqual(new Map([[1, 5], [2, 0], [3, 20]]));
  });

  it('refunds consumed quota best-effort', async () => {
    await refundSiteQuota(1, 2);
    expect(decrby).toHaveBeenCalledWith(expect.stringContaining('zenith:analytics:quota:1:'), 2);
  });
});
