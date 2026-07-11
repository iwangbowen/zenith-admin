import { beforeEach, describe, expect, it, vi } from 'vitest';

const { select, insert, update, onConflictDoNothing, returning, broadcast, currentMemberOrNull, resolveSiteByKey } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  onConflictDoNothing: vi.fn(),
  returning: vi.fn(),
  broadcast: vi.fn(),
  currentMemberOrNull: vi.fn(),
  resolveSiteByKey: vi.fn(),
}));

vi.mock('../../db', () => ({
  db: { select, insert, update },
}));

vi.mock('../../lib/tenant', () => ({
  currentCreateTenantId: () => 11,
  getCreateTenantId: () => 11,
}));

vi.mock('../../lib/context', () => ({
  currentUserOrNull: () => null,
}));

vi.mock('../../lib/member-context', () => ({
  currentMemberOrNull,
}));

vi.mock('../../lib/ws-manager', () => ({
  broadcast,
}));

vi.mock('./analytics-sites.service', () => ({
  resolveSiteByKey,
}));

import { getPublicConfig, getSettings, updateSettings } from './analytics-settings.service';

const row = {
  id: 9,
  tenantId: 11,
  enabled: true,
  sampleRate: 1,
  trackPageviews: true,
  trackClicks: true,
  trackPerformance: true,
  trackErrors: true,
  trackApi: true,
  maskInputs: true,
  respectDnt: false,
  anonymizeIp: false,
  blacklistPaths: [],
  retentionDays: 180,
  errorRetentionDays: 90,
  sessionTimeoutMinutes: 30,
  createdBy: null,
  updatedBy: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('analytics settings creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentMemberOrNull.mockReturnValue(undefined);
    resolveSiteByKey.mockResolvedValue(null);
    const results = [[], [row]];
    select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => results.shift() ?? [],
        }),
      }),
    }));
    returning.mockResolvedValue([]);
    onConflictDoNothing.mockReturnValue({ returning });
    insert.mockReturnValue({
      values: () => ({ onConflictDoNothing }),
    });
  });

  it('recovers from a concurrent first insert through the unique constraint', async () => {
    await expect(getSettings()).resolves.toMatchObject({ id: 9, sessionTimeoutMinutes: 30 });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(2);
  });
});

describe('analytics member public config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveSiteByKey.mockResolvedValue(null);
  });



  it('resolves anonymous public config by site key tenant and exposes site metadata', async () => {
    currentMemberOrNull.mockReturnValue(undefined);
    resolveSiteByKey.mockResolvedValue({ id: 6, tenantId: 11, appId: 'member', status: 'enabled', allowedOrigins: null, dailyEventQuota: null });
    select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ ...row, sampleRate: 0.5 }],
        }),
      }),
    }));

    await expect(getPublicConfig('zk_test')).resolves.toMatchObject({ sampleRate: 0.5, siteId: 6, appId: 'member' });
    expect(resolveSiteByKey).toHaveBeenCalledWith('zk_test');
  });

  it('resolves settings using the authenticated member tenant', async () => {
    currentMemberOrNull.mockReturnValue({ memberId: 8, identifier: 'member', type: 'member', tenantId: 11 });
    select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ ...row, sampleRate: 0.25 }],
        }),
      }),
    }));

    await expect(getPublicConfig()).resolves.toMatchObject({ sampleRate: 0.25 });
    expect(currentMemberOrNull).toHaveBeenCalled();
  });
});

describe('analytics settings update — hot reload broadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [row],
        }),
      }),
    }));
    update.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: async () => [{ ...row, enabled: false }],
        }),
      }),
    });
  });

  it('broadcasts analytics:config-updated with only the tenantId after a successful update, never the config content', async () => {
    await updateSettings({ enabled: false });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({ type: 'analytics:config-updated', payload: { tenantId: 11 } });
  });

  it('does not let a broadcast failure block the response', async () => {
    broadcast.mockImplementation(() => { throw new Error('ws down'); });
    await expect(updateSettings({ enabled: false })).resolves.toMatchObject({ enabled: false });
  });
});
