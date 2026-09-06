import { and, eq, sql } from 'drizzle-orm';
import { exactTenantCondition } from '../../lib/tenant';
import { analyticsUserProfiles } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import type { AnalyticsIdentityType } from '@zenith/shared/analytics';

/**
 * 行为中心：用户画像 upsert 的通用输入行。
 * 由 HTTP 采集（analytics.service.ts）与服务端权威事件（analytics-server-events.service.ts）
 * 共用，避免竞态安全的 upsert 逻辑重复实现导致两处行为漂移。
 */
export interface ProfileUpsertInput {
  tenantId: number | null;
  distinctId: string;
  identityType: AnalyticsIdentityType;
  userId: number | null;
  memberId: number | null;
  displayName: string | null;
  properties: Record<string, unknown>;
}

/**
 * 批量 upsert 用户画像（tenant + distinctId 唯一）。
 *
 * 唯一索引为表达式索引（coalesce(tenant_id, 0), distinct_id），Drizzle 的
 * onConflictDoUpdate 难以直接指定该 target；改用「插入忽略冲突 + 逐条更新」，
 * 竞态安全：并发写入即使同时插入也不会因唯一键冲突而报错，更新语句在插入是否
 * 命中冲突的两种情形下都会执行，保证画像最终一致。
 *
 * 调用方需自行按 (tenantId, distinctId) 去重（同一批次仅保留一条），本函数不做去重。
 */
export async function upsertUserProfilesBatch(executor: DbExecutor, inputs: ProfileUpsertInput[]): Promise<void> {
  if (inputs.length === 0) return;

  const now = new Date();
  const values = inputs.map((v) => ({
    tenantId: v.tenantId,
    distinctId: v.distinctId,
    identityType: v.identityType,
    userId: v.userId,
    memberId: v.memberId,
    displayName: v.displayName,
    properties: v.properties,
    firstSeenAt: now,
    lastSeenAt: now,
  }));

  await executor.insert(analyticsUserProfiles).values(values).onConflictDoNothing();
  for (const v of values) {
    const tenantMatch = exactTenantCondition(analyticsUserProfiles.tenantId, v.tenantId);
    await executor
      .update(analyticsUserProfiles)
      .set({
        // 身份只升不降：匿名写入不把已识别画像（admin/member）刷回 anonymous——
        // 前向身份合并后匿名批次会直接写权威 distinctId，必须保护既有身份归属
        ...(v.identityType === 'anonymous'
          ? {}
          : { identityType: v.identityType }),
        ...(v.userId != null ? { userId: v.userId } : {}),
        ...(v.memberId != null ? { memberId: v.memberId } : {}),
        // 两类写入方信息不对称（HTTP 采集带 displayName / 环境属性，服务端事件多为 null）：
        // displayName 仅在有新值时覆盖，properties 做 jsonb 合并（新键覆盖、旧键保留），
        // 避免服务端事件把 SPA 采集写入的画像字段冲刷为 null / 整包替换
        ...(v.displayName != null ? { displayName: v.displayName } : {}),
        properties: sql`COALESCE(${analyticsUserProfiles.properties}, '{}'::jsonb) || ${JSON.stringify(v.properties)}::jsonb`,
        lastSeenAt: v.lastSeenAt,
      })
      .where(and(tenantMatch, eq(analyticsUserProfiles.distinctId, v.distinctId)));
  }
}
