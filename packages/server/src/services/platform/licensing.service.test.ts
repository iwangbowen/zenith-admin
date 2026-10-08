import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LICENSE_FEATURES, type LicenseMode, type LicensePayload } from '@zenith/shared/licensing';
import type { LicenseSnapshot } from '../../lib/licensing';

const mocks = vi.hoisted(() => ({
  config: { licenseMode: 'required' as LicenseMode },
  select: vi.fn(),
  count: vi.fn(),
  snapshot: vi.fn(),
  installation: vi.fn(),
}));
vi.mock('../../config', () => ({ config: mocks.config }));
vi.mock('../../db', () => ({ db: { select: mocks.select, $count: mocks.count } }));
vi.mock('../../lib/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../../lib/licensing', () => ({
  getLicenseSnapshot: mocks.snapshot,
  ensureInstallation: mocks.installation,
  usingTestIssuerKey: () => false,
  verifyLicenseEnvelope: vi.fn(),
  bumpLicenseEpoch: vi.fn(),
  invalidateLicenseSnapshot: vi.fn(),
  evaluatePayloadStatus: vi.fn(),
}));
vi.mock('../messaging/notification-outbox.service', () => ({ notify: vi.fn() }));
vi.mock('../identity/platform-admins.service', () => ({ listEnabledPlatformSuperAdmins: vi.fn() }));

import { getLicensingStatus } from './licensing.service';

const payload: LicensePayload = {
  licenseId: 'license-test',
  audience: 'zenith-admin',
  installationId: 'eabf216d-bffd-4f34-9138-a22e89e583b7',
  customerId: 'customer-test',
  customerName: '测试客户',
  edition: 'enterprise',
  features: ['growth', 'iot'],
  limits: { maxUsers: null, maxTenants: null, maxNodes: null },
  issuedAt: '2026-01-01T00:00:00Z',
  notBefore: '2026-01-01T00:00:00Z',
  expiresAt: '2027-01-01T00:00:00Z',
  graceUntil: '2027-02-01T00:00:00Z',
  maintenanceUntil: null,
};

const snapshot: LicenseSnapshot = {
  licenseRowId: 7,
  status: 'active',
  features: new Set(payload.features),
  payload,
  invalidReason: null,
  restricted: false,
  licenseEpoch: 3,
  loadedAt: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.licenseMode = 'required';
  mocks.snapshot.mockResolvedValue(snapshot);
  mocks.installation.mockResolvedValue({ installationId: payload.installationId, createdAt: new Date('2026-01-01T00:00:00Z') });
  mocks.count.mockResolvedValue(2);
  const epochQuery = {
    from: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ licenseEpoch: 3 }]),
  };
  const licenseQuery = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{
      id: 7,
      licenseId: payload.licenseId,
      payload,
      status: 'active',
      keyId: 'issuer-test',
      activatedAt: new Date('2026-01-01T00:00:00Z'),
      lastVerifiedAt: null,
      invalidReason: null,
      replacedById: null,
    }]),
  };
  mocks.select.mockReturnValueOnce(epochQuery).mockReturnValue(licenseQuery);
});

describe('getLicensingStatus 生效功能投影', () => {
  it.each(['off', 'warn'] as const)('%s 模式始终提供全部矩阵功能', async (mode) => {
    mocks.config.licenseMode = mode;
    const status = await getLicensingStatus();
    expect(status.effective.mode).toBe(mode);
    expect(status.effective.features).toEqual([...LICENSE_FEATURES]);
    expect(status.effective.restricted).toBe(false);
  });

  it.each(['active', 'grace'] as const)('required：%s 仅显示 License 授予的可用功能', async (status) => {
    mocks.snapshot.mockResolvedValue({ ...snapshot, status });
    const result = await getLicensingStatus();
    expect(result.effective.features).toEqual(payload.features);
    expect(result.effective.restricted).toBe(false);
    expect(result.license?.features).toEqual(payload.features);
  });

  it.each(['expired', 'invalid', 'revoked'] as const)('required：%s 受限时矩阵无可用功能，保留授权文档的原始功能', async (status) => {
    mocks.snapshot.mockResolvedValue({ ...snapshot, status, restricted: true });
    const result = await getLicensingStatus();
    expect(result.effective.features).toEqual([]);
    expect(result.effective.restricted).toBe(true);
    expect(result.effective.status).toBe(status);
    expect(result.license?.features).toEqual(payload.features);
  });

  it('required：没有 License 时矩阵无可用功能', async () => {
    mocks.snapshot.mockResolvedValue({ ...snapshot, status: 'unlicensed', licenseRowId: null, features: new Set(), payload: null, restricted: true });
    const result = await getLicensingStatus();
    expect(result.license).toBeNull();
    expect(result.effective.features).toEqual([]);
    expect(result.effective.restricted).toBe(true);
  });
});
