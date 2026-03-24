import { eq } from 'drizzle-orm';
import { db } from '../db';
import { systemConfigs } from '../db/schema';

/** Get a system config value by key. Returns default if not found. */
export async function getConfigValue(key: string, defaultValue = ''): Promise<string> {
  const [row] = await db.select().from(systemConfigs).where(eq(systemConfigs.configKey, key)).limit(1);
  return row ? row.configValue : defaultValue;
}

/** Get a boolean config value */
export async function getConfigBoolean(key: string, defaultValue = false): Promise<boolean> {
  const val = await getConfigValue(key, String(defaultValue));
  return val === 'true' || val === '1';
}

/** Get a number config value */
export async function getConfigNumber(key: string, defaultValue = 0): Promise<number> {
  const val = await getConfigValue(key, String(defaultValue));
  const num = Number(val);
  return Number.isNaN(num) ? defaultValue : num;
}
