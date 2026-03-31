import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getConfigValue, getConfigBoolean, getConfigNumber } from './system-config';
import { config } from '../config';

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();

// Provide some simplified mock for the query builder
vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: mockLimit
          }))
        }))
      }))
    }
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  and: vi.fn((a, b) => ({ a, b })),
  isNull: vi.fn((c) => ({ c }))
}));

describe('system-config', () => {
  beforeEach(() => {
    config.multiTenantMode = true;
    mockLimit.mockReset();
  });

  describe('getConfigValue', () => {
    it('returns default value if nothing is found', async () => {
      mockLimit.mockResolvedValueOnce([]); // no tenant row
      mockLimit.mockResolvedValueOnce([]); // no platform row
      const val = await getConfigValue('NON_EXISTENT', 'default', 1);
      expect(val).toBe('default');
    });

    it('returns platform default if tenant mode is off and item exists', async () => {
      config.multiTenantMode = false;
      mockLimit.mockResolvedValueOnce([{ configValue: 'platform_val' }]);
      const val = await getConfigValue('EXISTING', 'default');
      expect(val).toBe('platform_val');
    });

    it('returns tenant specific value when available', async () => {
      mockLimit.mockResolvedValueOnce([{ configValue: 'tenant_val' }]);
      const val = await getConfigValue('KEY', 'default', 1);
      expect(val).toBe('tenant_val');
    });

    it('falls back to platform value if tenant specific is missing', async () => {
      mockLimit.mockResolvedValueOnce([]); // tenant missing
      mockLimit.mockResolvedValueOnce([{ configValue: 'platform_val' }]); // platform found
      const val = await getConfigValue('KEY', 'default', 1);
      expect(val).toBe('platform_val');
    });

    it('returns platform value if tenantId is not provided', async () => {
      mockLimit.mockResolvedValueOnce([{ configValue: 'platform_val' }]);
      const val = await getConfigValue('KEY', 'default');
      expect(val).toBe('platform_val');
    });
  });

  describe('getConfigBoolean', () => {
    it('returns true for "true"', async () => {
      mockLimit.mockResolvedValueOnce([{ configValue: 'true' }]);
      const val = await getConfigBoolean('KEY', false);
      expect(val).toBe(true);
    });

    it('returns true for "1"', async () => {
      mockLimit.mockResolvedValueOnce([{ configValue: '1' }]);
      const val = await getConfigBoolean('KEY', false);
      expect(val).toBe(true);
    });

    it('returns false for "false"', async () => {
      mockLimit.mockResolvedValueOnce([{ configValue: 'false' }]);
      const val = await getConfigBoolean('KEY', true);
      expect(val).toBe(false);
    });

    it('returns default value if not found', async () => {
      mockLimit.mockResolvedValueOnce([]);
      const val = await getConfigBoolean('KEY', true); // default gets cast to "true" string initially
      expect(val).toBe(true);
    });
  });

  describe('getConfigNumber', () => {
    it('returns parsed number', async () => {
      mockLimit.mockResolvedValueOnce([{ configValue: '42' }]);
      const val = await getConfigNumber('KEY', 0);
      expect(val).toBe(42);
    });

    it('returns defaultValue if parsed is NaN', async () => {
      mockLimit.mockResolvedValueOnce([{ configValue: 'not-a-number' }]);
      const val = await getConfigNumber('KEY', 10);
      expect(val).toBe(10);
    });

    it('returns default value if not found', async () => {
      mockLimit.mockResolvedValueOnce([]);
      const val = await getConfigNumber('KEY', 99);
      expect(val).toBe(99);
    });

    it('handles negative numbers', async () => {
      mockLimit.mockResolvedValueOnce([{ configValue: '-5' }]);
      const val = await getConfigNumber('KEY', 0);
      expect(val).toBe(-5);
    });

    it('handles floats', async () => {
      mockLimit.mockResolvedValueOnce([{ configValue: '3.14' }]);
      const val = await getConfigNumber('KEY', 0);
      expect(val).toBe(3.14);
    });
  });
});
