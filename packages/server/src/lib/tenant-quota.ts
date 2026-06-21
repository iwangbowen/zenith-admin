import { eq } from 'drizzle-orm';
import { db } from '../db';
import { tenants, users } from '../db/schema';
import { config } from '../config';
import { HTTPException } from 'hono/http-exception';

/**
 * 返回租户的「最大用户数」上限。返回 `null` 表示**不限制**：
 *  - 多租户模式关闭
 *  - `tenantId` 为空（平台级用户）
 *  - 该租户未设置 `maxUsers`
 */
export async function getTenantUserLimit(tenantId: number | null | undefined): Promise<number | null> {
  if (!config.multiTenantMode || tenantId == null) return null;
  const [tenant] = await db.select({ maxUsers: tenants.maxUsers }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return tenant?.maxUsers ?? null;
}

/**
 * 新增用户前校验租户用户数上限（仅多租户模式 + 租户设置了 maxUsers 时生效）。
 * 超限抛 `HTTPException(400)`。`adding` 为本次拟新增数量（默认 1）。
 */
export async function ensureTenantUserQuota(tenantId: number | null | undefined, adding = 1): Promise<void> {
  const limit = await getTenantUserLimit(tenantId);
  if (limit == null || tenantId == null) return;
  const count = await db.$count(users, eq(users.tenantId, tenantId));
  if (count + adding > limit) {
    throw new HTTPException(400, { message: `该租户用户数已达上限（${limit}），无法新增` });
  }
}
