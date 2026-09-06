/**
 * 行为中心：身份映射与匿名事件回溯合并。
 *
 * 解决「匿名 distinctId 膨胀」：登录前的匿名事件 distinctId=anonymousId，与登录后的
 * `u:<id>` / `m:<id>` 被当成两个访客，UV / 留存 / 漏斗全部虚高。
 *
 * 三段合并策略（对标 PostHog person 合并的简化版）：
 * 1. 首绑（$identify 落库时）：anonymousId → 权威 distinctId 写入 analytics_identity_map，
 *    ON CONFLICT DO NOTHING = 首绑优先，共享设备上第二个账号不会抢走既有绑定（防串号）；
 * 2. 前向合并（匿名 ingest 批次）：命中映射的匿名事件在入库前直接改写 distinctId 归属权威身份；
 * 3. 回溯合并（$identify 后 best-effort）：历史匿名 user_events 改写 distinct_id，
 *    其所属 analytics_sessions 归属登录身份，匿名画像行并入权威画像（firstSeen 取 MIN 后删除）。
 *    合并幂等：重复 $identify 时 WHERE 条件自然短路。
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { exactTenantCondition } from '../../lib/tenant';
import { db } from '../../db';
import { analyticsIdentityMap, analyticsSessions, analyticsUserProfiles, userEvents } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import type { AnalyticsIdentityType } from '@zenith/shared/analytics';
import logger from '../../lib/logger';

export interface IdentityBinding {
  tenantId: number | null;
  anonymousId: string;
  distinctId: string;
  identityType: Exclude<AnalyticsIdentityType, 'anonymous'>;
  userId: number | null;
  memberId: number | null;
  displayName: string | null;
}

function tenantMatch(column: typeof analyticsIdentityMap.tenantId, tenantId: number | null) {
  return exactTenantCondition(column, tenantId);
}

/** $identify 首绑：写入匿名 → 权威身份映射（已存在时保持首绑不覆盖）。 */
export async function upsertIdentityBindings(executor: DbExecutor, bindings: IdentityBinding[]): Promise<void> {
  if (bindings.length === 0) return;
  await executor
    .insert(analyticsIdentityMap)
    .values(bindings.map((b) => ({
      tenantId: b.tenantId,
      anonymousId: b.anonymousId,
      distinctId: b.distinctId,
      identityType: b.identityType,
      userId: b.userId,
      memberId: b.memberId,
    })))
    .onConflictDoNothing();
}

/** 匿名批次前向合并：批量解析 anonymousId → 权威 distinctId 映射。 */
export async function resolveAnonymousMappings(
  anonymousIds: string[],
  tenantId: number | null,
): Promise<Map<string, { distinctId: string; identityType: AnalyticsIdentityType; userId: number | null; memberId: number | null }>> {
  if (anonymousIds.length === 0) return new Map();
  const rows = await db
    .select({
      anonymousId: analyticsIdentityMap.anonymousId,
      distinctId: analyticsIdentityMap.distinctId,
      identityType: analyticsIdentityMap.identityType,
      userId: analyticsIdentityMap.userId,
      memberId: analyticsIdentityMap.memberId,
    })
    .from(analyticsIdentityMap)
    .where(and(inArray(analyticsIdentityMap.anonymousId, anonymousIds), tenantMatch(analyticsIdentityMap.tenantId, tenantId)));
  return new Map(rows.map((r) => [r.anonymousId, { distinctId: r.distinctId, identityType: r.identityType, userId: r.userId, memberId: r.memberId }]));
}

/**
 * 回溯合并单个匿名身份（$identify 后调用，best-effort：失败不影响采集，下次 identify 幂等重试）。
 * 事件量以匿名浏览会话为界（通常几十到几百行），三条 UPDATE/DELETE 在单事务内完成。
 */
export async function mergeAnonymousIdentity(binding: IdentityBinding): Promise<void> {
  const { tenantId, anonymousId, distinctId } = binding;
  await db.transaction(async (tx) => {
    // 1) 历史匿名事件改写 distinct_id（不伪造 user_id/username：事件仍是匿名期产生的）
    await tx
      .update(userEvents)
      .set({ distinctId })
      .where(and(
        eq(userEvents.anonymousId, anonymousId),
        isNull(userEvents.userId),
        isNull(userEvents.memberId),
        sql`${userEvents.distinctId} <> ${distinctId}`,
        exactTenantCondition(userEvents.tenantId, tenantId),
      ));

    // 2) 匿名会话归属登录身份（匿名会话行 distinct_id = sessionId，需经 user_events 关联定位）
    await tx.execute(sql`
      UPDATE ${analyticsSessions} s
      SET distinct_id = ${distinctId},
          user_id = COALESCE(s.user_id, ${binding.userId}),
          username = COALESCE(s.username, ${binding.displayName}),
          member_id = COALESCE(s.member_id, ${binding.memberId})
      WHERE s.user_id IS NULL AND s.member_id IS NULL
        AND s.tenant_id IS NOT DISTINCT FROM ${tenantId}
        AND s.session_id IN (
          SELECT DISTINCT session_id FROM ${userEvents}
          WHERE anonymous_id = ${anonymousId}
            AND tenant_id IS NOT DISTINCT FROM ${tenantId}
        )
    `);

    // 3) 匿名画像并入权威画像：firstSeen 取 MIN、properties 补缺（权威画像已有键优先），随后删除匿名行
    await tx.execute(sql`
      UPDATE ${analyticsUserProfiles} c
      SET first_seen_at = LEAST(c.first_seen_at, a.first_seen_at),
          properties = COALESCE(a.properties, '{}'::jsonb) || COALESCE(c.properties, '{}'::jsonb)
      FROM ${analyticsUserProfiles} a
      WHERE c.distinct_id = ${distinctId}
        AND a.distinct_id = ${anonymousId}
        AND COALESCE(c.tenant_id, 0) = COALESCE(${tenantId}::int, 0)
        AND COALESCE(a.tenant_id, 0) = COALESCE(${tenantId}::int, 0)
    `);
    await tx
      .delete(analyticsUserProfiles)
      .where(and(
        eq(analyticsUserProfiles.distinctId, anonymousId),
        exactTenantCondition(analyticsUserProfiles.tenantId, tenantId),
      ));
  });
}

/** $identify 批次的合并入口：首绑 + 回溯，全程 best-effort 不阻塞采集响应。 */
export async function processIdentityBindings(bindings: IdentityBinding[]): Promise<void> {
  for (const binding of bindings) {
    try {
      await upsertIdentityBindings(db, [binding]);
      await mergeAnonymousIdentity(binding);
    } catch (err) {
      logger.warn('[analytics] identity merge failed (will retry on next identify)', {
        anonymousId: binding.anonymousId,
        distinctId: binding.distinctId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
