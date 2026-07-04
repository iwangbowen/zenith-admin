import { and, eq, like, desc, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { analyticsEventMeta } from '../../db/schema';
import type { AnalyticsEventMetaRow } from '../../db/schema';
import type { TrackEventInput, CreateAnalyticsEventMetaInput, UpdateAnalyticsEventMetaInput } from '@zenith/shared';
import { mergeWhere, escapeLike } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';

export function mapEventMeta(row: AnalyticsEventMetaRow) {
  return {
    id: row.id,
    eventName: row.eventName,
    displayName: row.displayName,
    category: row.category,
    description: row.description,
    propertySchema: row.propertySchema ?? null,
    status: row.status,
    eventCount: Number(row.eventCount),
    firstSeenAt: formatNullableDateTime(row.firstSeenAt),
    lastSeenAt: formatNullableDateTime(row.lastSeenAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
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
  for (const [eventName, { count, category }] of counts) {
    await db
      .insert(analyticsEventMeta)
      .values({ tenantId, eventName, category, eventCount: count, firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: analyticsEventMeta.eventName,
        set: { eventCount: sql`${analyticsEventMeta.eventCount} + ${count}`, lastSeenAt: now },
      });
  }
}

// ─── 字典封禁名单（采集入口拒收 status='blocked' 的事件）──────────────────────
const BLOCKED_CACHE_TTL_MS = 60_000;
let blockedCache: { names: Set<string>; fetchedAt: number } | null = null;

export async function getBlockedEventNames(): Promise<Set<string>> {
  const now = Date.now();
  if (blockedCache && now - blockedCache.fetchedAt < BLOCKED_CACHE_TTL_MS) return blockedCache.names;
  const rows = await db
    .select({ eventName: analyticsEventMeta.eventName })
    .from(analyticsEventMeta)
    .where(eq(analyticsEventMeta.status, 'blocked'));
  blockedCache = { names: new Set(rows.map((r) => r.eventName)), fetchedAt: now };
  return blockedCache.names;
}

/** 字典状态变更后立即失效缓存。 */
export function invalidateBlockedEventCache(): void { blockedCache = null; }

export interface EventMetaListQuery { page?: number; pageSize?: number; keyword?: string; status?: string; category?: string }
export async function listEventMeta(q: EventMetaListQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 100);
  const conditions = [];
  if (q.keyword) conditions.push(like(analyticsEventMeta.eventName, `%${escapeLike(q.keyword)}%`));
  if (q.status) conditions.push(eq(analyticsEventMeta.status, q.status as 'active'));
  if (q.category) conditions.push(eq(analyticsEventMeta.category, q.category));
  // 事件字典为平台级全局分类（事件名全局唯一，跨租户共享），不做租户隔离
  const where = mergeWhere(conditions.length ? and(...conditions) : undefined, undefined);

  const [list, total] = await Promise.all([
    db.select().from(analyticsEventMeta).where(where).orderBy(desc(analyticsEventMeta.eventCount)).limit(pageSize).offset(pageOffset(page, pageSize)),
    db.$count(analyticsEventMeta, where),
  ]);
  return { list: list.map(mapEventMeta), total, page, pageSize };
}

export async function ensureEventMetaExists(id: number) {
  const [row] = await db.select().from(analyticsEventMeta).where(eq(analyticsEventMeta.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '事件不存在' });
  return row;
}

export async function createEventMeta(input: CreateAnalyticsEventMetaInput) {
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
      })
      .returning();
    invalidateBlockedEventCache();
    return mapEventMeta(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '事件名称已存在');
    throw err;
  }
}

export async function updateEventMeta(id: number, input: UpdateAnalyticsEventMetaInput) {
  await ensureEventMetaExists(id);
  const [row] = await db
    .update(analyticsEventMeta)
    .set({
      ...(input.eventName !== undefined ? { eventName: input.eventName } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.propertySchema !== undefined ? { propertySchema: input.propertySchema } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    })
    .where(eq(analyticsEventMeta.id, id))
    .returning();
  invalidateBlockedEventCache();
  return mapEventMeta(row);
}

export async function deleteEventMeta(id: number) {
  await ensureEventMetaExists(id);
  await db.delete(analyticsEventMeta).where(eq(analyticsEventMeta.id, id));
  invalidateBlockedEventCache();
}
