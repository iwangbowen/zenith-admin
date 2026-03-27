import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db';
import { systemConfigs } from '../db/schema';
import { config } from '../config';

/**
 * Get a system config value by key.
 * In multi-tenant mode: first look for tenant-specific value, then fallback to platform default (tenantId=null).
 */
export async function getConfigValue(key: string, defaultValue = '', tenantId?: number | null): Promise<string> {
  if (config.multiTenantMode && tenantId !== undefined && tenantId !== null) {
    // Try tenant-specific first
    const [tenantRow] = await db.select().from(systemConfigs)
      .where(and(eq(systemConfigs.configKey, key), eq(systemConfigs.tenantId, tenantId)))
      .limit(1);
    if (tenantRow) return tenantRow.configValue;
  }
  // Fallback to platform default (tenantId is null)
  const [row] = await db.select().from(systemConfigs)
    .where(and(eq(systemConfigs.configKey, key), isNull(systemConfigs.tenantId)))
    .limit(1);
  return row ? row.configValue : defaultValue;
}

/** Get a boolean config value */
export async function getConfigBoolean(key: string, defaultValue = false, tenantId?: number | null): Promise<boolean> {
  const val = await getConfigValue(key, String(defaultValue), tenantId);
  return val === 'true' || val === '1';
}

/** Get a number config value */
export async function getConfigNumber(key: string, defaultValue = 0, tenantId?: number | null): Promise<number> {
  const val = await getConfigValue(key, String(defaultValue), tenantId);
  const num = Number(val);
  return Number.isNaN(num) ? defaultValue : num;
}
