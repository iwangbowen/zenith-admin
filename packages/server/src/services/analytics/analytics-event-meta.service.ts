import { eq, desc, sql } from 'drizzle-orm';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { analyticsEventMeta, analyticsSavedReports, analyticsUserSegments, analyticsExperiments, users } from '../../db/schema';
import type { AnalyticsEventMetaRow } from '../../db/schema';
import type { QueryOutputOf } from '@zenith/shared/core';
import { analyticsContract } from '@zenith/shared/analytics';
import type { TrackEventInput, CreateAnalyticsEventMetaInput, UpdateAnalyticsEventMetaInput } from '@zenith/shared/analytics';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUser } from '../../lib/context';
import { isPlatformAdmin, tenantScope } from '../../lib/tenant';
import { invalidateGovernanceCache } from './analytics-governance.service';

export function mapEventMeta(row: AnalyticsEventMetaRow) {
  return {
    id: row.id,
    eventName: row.eventName,
    displayName: row.displayName,
    category: row.category,
    description: row.description,
    propertySchema: row.propertySchema ?? null,
    status: row.status,
    version: row.version,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    strictMode: row.strictMode,
    eventCount: Number(row.eventCount),
    firstSeenAt: formatNullableDateTime(row.firstSeenAt),
    lastSeenAt: formatNullableDateTime(row.lastSeenAt),
    ...formatTimestamps(row),
  };
}

/** 采集时自动登记事件字典（仅登记带显式 eventName 的事件）。 */
export async function touchEventMeta(events: TrackEventInput[], tenantId: number | null): Promise<void> {
  const counts = new Map<string, { count: number; category: string }>();
  for (const e of events) {
    if (!e.eventName) continue;
    const cur = counts.get(e.eventName) ?? { count: 0, category: e.eventType };
    cur.count += 1;
    counts.set(e.eventName, cur);
  }
  if (counts.size === 0) return;
  const now = new Date();
  // 单条多行 upsert：冲突行经 excluded 引用各自批次计数，避免按事件名逐条串行往返（采集热路径）
  await db
    .insert(analyticsEventMeta)
    .values([...counts].map(([eventName, { count, category }]) => ({
      tenantId, eventName, category, eventCount: count, firstSeenAt: now, lastSeenAt: now,
    })))
    .onConflictDoUpdate({
      target: analyticsEventMeta.eventName,
      set: { eventCount: sql`${analyticsEventMeta.eventCount} + excluded.event_count`, lastSeenAt: now },
    });
}

// ─── 责任人存在性校验（不信任客户端 ownerName，服务端解析）──────────────────────
/** 校验 ownerId 对应用户存在且启用，返回服务端解析的展示名，杜绝客户端伪造 ownerName。 */
async function resolveOwnerName(ownerId: number): Promise<string> {
  const [owner] = await db.select({ nickname: users.nickname, status: users.status }).from(users).where(eq(users.id, ownerId)).limit(1);
  if (!owner || owner.status !== 'enabled') throw new HTTPException(400, { message: '负责人不存在或已停用' });
  return owner.nickname;
}

export async function listEventMeta(q: QueryOutputOf<typeof analyticsContract.eventMeta>) {
  const { page, pageSize } = q;
  // 事件字典为平台级全局分类（事件名全局唯一，跨租户共享），不做租户隔离
  const where = buildWhere(
    keywordCondition(q.keyword, [analyticsEventMeta.eventName]),
    q.status ? eq(analyticsEventMeta.status, q.status) : undefined,
    q.category ? eq(analyticsEventMeta.category, q.category) : undefined,
  );

  return buildListResult({
    page: page,
    pageSize: pageSize,
    count: () => db.$count(analyticsEventMeta, where),
    rows: () => db.select().from(analyticsEventMeta).where(where).orderBy(desc(analyticsEventMeta.eventCount)).limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapEventMeta,
  });
}

export async function ensureEventMetaExists(id: number) {
  const [row] = await db.select().from(analyticsEventMeta).where(eq(analyticsEventMeta.id, id)).limit(1);
  return requireRow(row, '事件不存在');
}

function ensureBlockedStatusPermission(currentStatus: AnalyticsEventMetaRow['status'] | null, nextStatus: AnalyticsEventMetaRow['status'] | null): void {
  if (currentStatus !== 'blocked' && nextStatus !== 'blocked') return;
  if (!isPlatformAdmin(currentUser())) {
    throw new HTTPException(403, { message: '仅平台超级管理员可以屏蔽或修改已屏蔽事件' });
  }
}

export async function createEventMeta(input: CreateAnalyticsEventMetaInput) {
  ensureBlockedStatusPermission(null, input.status ?? 'active');
  const ownerName = input.ownerId != null ? await resolveOwnerName(input.ownerId) : null;
  try {
    const [row] = await db
      .insert(analyticsEventMeta)
      .values({
        eventName: input.eventName,
        displayName: input.displayName ?? null,
        category: input.category ?? null,
        description: input.description ?? null,
        propertySchema: input.propertySchema ?? null,
        status: input.status ?? 'active',
        ownerId: input.ownerId ?? null,
        ownerName,
        strictMode: input.strictMode ?? false,
      })
      .returning();
    invalidateGovernanceCache();
    return mapEventMeta(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '事件名称已存在');
    throw err;
  }
}

export async function updateEventMeta(id: number, input: UpdateAnalyticsEventMetaInput) {
  const current = await ensureEventMetaExists(id);
  ensureBlockedStatusPermission(current.status, input.status ?? current.status);
  const ownerName = input.ownerId !== undefined && input.ownerId !== null ? await resolveOwnerName(input.ownerId) : undefined;
  const [row] = await db
    .update(analyticsEventMeta)
    .set({
      ...(input.eventName !== undefined ? { eventName: input.eventName } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.propertySchema !== undefined ? { propertySchema: input.propertySchema } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId, ownerName: input.ownerId === null ? null : ownerName } : {}),
      ...(input.strictMode !== undefined ? { strictMode: input.strictMode } : {}),
      ...(
        input.eventName !== undefined || input.propertySchema !== undefined || input.strictMode !== undefined
          ? { version: sql`${analyticsEventMeta.version} + 1` }
          : {}
      ),
    })
    .where(eq(analyticsEventMeta.id, id))
    .returning();
  invalidateGovernanceCache();
  return mapEventMeta(row);
}

export async function deleteEventMeta(id: number) {
  const current = await ensureEventMetaExists(id);
  ensureBlockedStatusPermission(current.status, null);
  await db.delete(analyticsEventMeta).where(eq(analyticsEventMeta.id, id));
  invalidateGovernanceCache();
}

// ─── 下游影响分析（屏蔽 / 删除 / 改契约前的引用面）────────────────────────────
/**
 * 实时查询事件名在漏斗报表 / 分群规则 / A/B 实验中的引用。
 * 不维护引用登记表：三表均为小表，JSONB 包含匹配即可，避免第二份事实。
 * 租户管理员只看到本租户引用，平台管理员看全部（tenantScope 语义）。
 */
export async function getEventMetaReferences(eventName: string) {
  const elementMatch = JSON.stringify([{ eventName }]);
  const [savedReports, segments, experiments] = await Promise.all([
    db.select({ id: analyticsSavedReports.id, name: analyticsSavedReports.name })
      .from(analyticsSavedReports)
      .where(buildWhere(sql`${analyticsSavedReports.config}->'steps' @> ${elementMatch}::jsonb`, tenantScope(analyticsSavedReports)))
      .orderBy(analyticsSavedReports.id)
      .limit(50),
    db.select({ id: analyticsUserSegments.id, name: analyticsUserSegments.name })
      .from(analyticsUserSegments)
      .where(buildWhere(sql`${analyticsUserSegments.rules}->'conditions' @> ${elementMatch}::jsonb`, tenantScope(analyticsUserSegments)))
      .orderBy(analyticsUserSegments.id)
      .limit(50),
    db.select({ id: analyticsExperiments.id, name: analyticsExperiments.name })
      .from(analyticsExperiments)
      .where(buildWhere(eq(analyticsExperiments.metricEventName, eventName), tenantScope(analyticsExperiments)))
      .orderBy(analyticsExperiments.id)
      .limit(50),
  ]);
  return { savedReports, segments, experiments, total: savedReports.length + segments.length + experiments.length };
}
