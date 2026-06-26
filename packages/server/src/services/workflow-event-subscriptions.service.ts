import { and, desc, eq, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  workflowEventSubscriptions,
  workflowEventDeliveries,
  workflowDefinitions,
} from '../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../lib/context';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { escapeLike } from '../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { pageOffset } from '../lib/pagination';
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';
import type { WorkflowEventType } from '@zenith/shared';

function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

function parseEvents(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function parseHeaders(raw: string | null | undefined): Record<string, string> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out: Record<string, string> = {};
      for (const [k, vv] of Object.entries(v)) {
        if (typeof vv === 'string') out[k] = vv;
      }
      return Object.keys(out).length ? out : null;
    }
  } catch { /* ignore */ }
  return null;
}

export function mapSubscription(
  row: typeof workflowEventSubscriptions.$inferSelect,
  definitionName?: string | null,
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    definitionId: row.definitionId,
    definitionName: definitionName ?? null,
    events: parseEvents(row.events),
    url: row.url,
    secretMasked: maskSecret(row.secret),
    signMode: row.signMode,
    headers: parseHeaders(row.headers),
    enabled: row.enabled,
    tenantId: row.tenantId,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureSubscriptionExists(id: number) {
  const tc = tenantCondition(workflowEventSubscriptions, currentUser());
  const conds = [eq(workflowEventSubscriptions.id, id)];
  if (tc) conds.push(tc);
  const [row] = await db.select().from(workflowEventSubscriptions).where(and(...conds)).limit(1);
  if (!row) throw new HTTPException(404, { message: '事件订阅不存在' });
  return row;
}

export interface ListSubscriptionsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  definitionId?: number | null;
  enabled?: boolean;
}

export async function listSubscriptions(q: ListSubscriptionsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  const tc = tenantCondition(workflowEventSubscriptions, currentUser());
  const conds = [];
  if (tc) conds.push(tc);
  if (q.keyword) {
    const k = `%${escapeLike(q.keyword)}%`;
    conds.push(or(ilike(workflowEventSubscriptions.name, k), ilike(workflowEventSubscriptions.url, k))!);
  }
  if (q.definitionId !== undefined) {
    conds.push(q.definitionId === null ? isNull(workflowEventSubscriptions.definitionId) : eq(workflowEventSubscriptions.definitionId, q.definitionId));
  }
  if (q.enabled !== undefined) conds.push(eq(workflowEventSubscriptions.enabled, q.enabled));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(workflowEventSubscriptions, where),
    db.select({
      sub: workflowEventSubscriptions,
      definitionName: workflowDefinitions.name,
    }).from(workflowEventSubscriptions)
      .leftJoin(workflowDefinitions, eq(workflowEventSubscriptions.definitionId, workflowDefinitions.id))
      .where(where)
      .orderBy(desc(workflowEventSubscriptions.id))
      .limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map((r) => mapSubscription(r.sub, r.definitionName)), total, page, pageSize };
}

export async function getSubscription(id: number) {
  const row = await ensureSubscriptionExists(id);
  let definitionName: string | null = null;
  if (row.definitionId) {
    const [d] = await db.select({ name: workflowDefinitions.name }).from(workflowDefinitions).where(eq(workflowDefinitions.id, row.definitionId)).limit(1);
    definitionName = d?.name ?? null;
  }
  return mapSubscription(row, definitionName);
}

export async function getSubscriptionBeforeAudit(id: number) {
  return getSubscription(id).catch((err) => {
    if (err instanceof HTTPException && err.status === 404) return null;
    throw err;
  });
}

export async function getSubscriptionSecret(id: number) {
  const row = await ensureSubscriptionExists(id);
  return { id: row.id, secret: row.secret ?? null };
}

export interface UpsertSubscriptionInput {
  name: string;
  description?: string | null;
  definitionId?: number | null;
  events: WorkflowEventType[];
  url: string;
  secret?: string | null;
  signMode?: 'hmacSha256' | 'none';
  headers?: Record<string, string> | null;
  enabled?: boolean;
}

export async function createSubscription(input: UpsertSubscriptionInput) {
  if (input.events.length === 0) throw new HTTPException(400, { message: '至少订阅一个事件类型' });
  try {
    const user = currentUser();
    const [row] = await db.insert(workflowEventSubscriptions).values({
      name: input.name,
      description: input.description ?? null,
      definitionId: input.definitionId ?? null,
      events: JSON.stringify(input.events),
      url: input.url,
      secret: input.secret ?? null,
      signMode: input.signMode ?? 'hmacSha256',
      headers: input.headers ? JSON.stringify(input.headers) : null,
      enabled: input.enabled ?? true,
      tenantId: getCreateTenantId(user),
      createdBy: user.userId,
      updatedBy: user.userId,
    }).returning();
    return mapSubscription(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '订阅名称已存在');
  }
}

export async function updateSubscription(id: number, input: Partial<UpsertSubscriptionInput>) {
  await ensureSubscriptionExists(id);
  const user = currentUser();
  const tc = tenantCondition(workflowEventSubscriptions, user);
  const conds = [eq(workflowEventSubscriptions.id, id)];
  if (tc) conds.push(tc);
  const patch: Partial<typeof workflowEventSubscriptions.$inferInsert> = { updatedBy: user.userId, updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.definitionId !== undefined) patch.definitionId = input.definitionId;
  if (input.events !== undefined) {
    if (input.events.length === 0) throw new HTTPException(400, { message: '至少订阅一个事件类型' });
    patch.events = JSON.stringify(input.events);
  }
  if (input.url !== undefined) patch.url = input.url;
  if (input.secret !== undefined) patch.secret = input.secret;
  if (input.signMode !== undefined) patch.signMode = input.signMode;
  if (input.headers !== undefined) patch.headers = input.headers ? JSON.stringify(input.headers) : null;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  try {
    const [row] = await db.update(workflowEventSubscriptions).set(patch).where(and(...conds)).returning();
    if (!row) throw new HTTPException(404, { message: '事件订阅不存在' });
    return mapSubscription(row);
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    rethrowPgUniqueViolation(err, '订阅名称已存在');
  }
}

export async function deleteSubscription(id: number) {
  await ensureSubscriptionExists(id);
  const tc = tenantCondition(workflowEventSubscriptions, currentUser());
  const conds = [eq(workflowEventSubscriptions.id, id)];
  if (tc) conds.push(tc);
  await db.delete(workflowEventSubscriptions).where(and(...conds));
}

export async function toggleSubscription(id: number, enabled: boolean) {
  return updateSubscription(id, { enabled });
}

/**
 * 内部 API：查找匹配的订阅；不受 currentUser() 限制，由事件总线后台调用。
 */
export async function findMatchingSubscriptions(params: {
  definitionId: number;
  eventType: WorkflowEventType;
  tenantId: number | null;
}) {
  const { definitionId, eventType, tenantId } = params;
  const tenantCond = tenantId === null
    ? isNull(workflowEventSubscriptions.tenantId)
    : or(isNull(workflowEventSubscriptions.tenantId), eq(workflowEventSubscriptions.tenantId, tenantId))!;
  const defCond = or(isNull(workflowEventSubscriptions.definitionId), eq(workflowEventSubscriptions.definitionId, definitionId))!;
  const rows = await db.select().from(workflowEventSubscriptions).where(and(
    eq(workflowEventSubscriptions.enabled, true),
    tenantCond,
    defCond,
  ));
  return rows.filter((r) => parseEvents(r.events).includes(eventType));
}

// ─── 投递记录 ──────────────────────────────────────────────────────────────

export function mapDelivery(row: typeof workflowEventDeliveries.$inferSelect, subscriptionName?: string | null) {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    subscriptionName: subscriptionName ?? null,
    instanceId: row.instanceId,
    taskId: row.taskId,
    eventId: row.eventId,
    eventType: row.eventType,
    payload: row.payload,
    attempt: row.attempt,
    status: row.status,
    requestUrl: row.requestUrl,
    requestHeaders: parseHeaders(row.requestHeaders),
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
    errorMessage: row.errorMessage,
    durationMs: row.durationMs,
    nextRetryAt: formatNullableDateTime(row.nextRetryAt),
    startedAt: formatNullableDateTime(row.startedAt),
    finishedAt: formatNullableDateTime(row.finishedAt),
    tenantId: row.tenantId,
    createdAt: formatDateTime(row.createdAt),
  };
}

export interface ListDeliveriesQuery {
  page?: number;
  pageSize?: number;
  subscriptionId?: number;
  instanceId?: number;
  status?: 'pending' | 'success' | 'failed' | 'retrying';
}

export async function listDeliveries(q: ListDeliveriesQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  const tc = tenantCondition(workflowEventDeliveries, currentUser());
  const conds = [];
  if (tc) conds.push(tc);
  if (q.subscriptionId) conds.push(eq(workflowEventDeliveries.subscriptionId, q.subscriptionId));
  if (q.instanceId) conds.push(eq(workflowEventDeliveries.instanceId, q.instanceId));
  if (q.status) conds.push(eq(workflowEventDeliveries.status, q.status));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(workflowEventDeliveries, where),
    db.select({ d: workflowEventDeliveries, subName: workflowEventSubscriptions.name })
      .from(workflowEventDeliveries)
      .leftJoin(workflowEventSubscriptions, eq(workflowEventDeliveries.subscriptionId, workflowEventSubscriptions.id))
      .where(where).orderBy(desc(workflowEventDeliveries.id))
      .limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map((r) => mapDelivery(r.d, r.subName)), total, page, pageSize };
}

export async function getDelivery(id: number) {
  const tc = tenantCondition(workflowEventDeliveries, currentUser());
  const conds = [eq(workflowEventDeliveries.id, id)];
  if (tc) conds.push(tc);
  const [row] = await db.select().from(workflowEventDeliveries).where(and(...conds)).limit(1);
  if (!row) throw new HTTPException(404, { message: '投递记录不存在' });
  return mapDelivery(row);
}

export async function getDeliveryBeforeAudit(id: number) {
  return getDelivery(id).catch((err) => {
    if (err instanceof HTTPException && err.status === 404) return null;
    throw err;
  });
}

export async function getDeliveriesBeforeAudit(ids: number[]) {
  if (!ids.length) return [];
  const tc = tenantCondition(workflowEventDeliveries, currentUser());
  const conds = [inArray(workflowEventDeliveries.id, ids)];
  if (tc) conds.push(tc);
  const rows = await db.select({ d: workflowEventDeliveries, subName: workflowEventSubscriptions.name })
    .from(workflowEventDeliveries)
    .leftJoin(workflowEventSubscriptions, eq(workflowEventDeliveries.subscriptionId, workflowEventSubscriptions.id))
    .where(and(...conds))
    .orderBy(desc(workflowEventDeliveries.id));
  return rows.map((r) => mapDelivery(r.d, r.subName));
}

/** 候选重试任务：状态 retrying 且 nextRetryAt 已到 */
export async function findRetryableDeliveries(limit = 50) {
  const rows = await db.select().from(workflowEventDeliveries)
    .where(and(
      eq(workflowEventDeliveries.status, 'retrying'),
      lte(workflowEventDeliveries.nextRetryAt, sql`now()`),
    ))
    .limit(limit);
  return rows;
}

export async function findDeliveryById(id: number) {
  const [row] = await db.select().from(workflowEventDeliveries).where(eq(workflowEventDeliveries.id, id)).limit(1);
  return row ?? null;
}

/** 内部 API：插入待投递记录（由订阅者调用） */
export async function insertDelivery(input: {
  subscriptionId: number;
  instanceId: number | null;
  taskId: number | null;
  eventId: string;
  eventType: string;
  payload: unknown;
  tenantId: number | null;
}) {
  const [row] = await db.insert(workflowEventDeliveries).values({
    subscriptionId: input.subscriptionId,
    instanceId: input.instanceId,
    taskId: input.taskId,
    eventId: input.eventId,
    eventType: input.eventType,
    payload: input.payload,
    status: 'pending',
    tenantId: input.tenantId,
  }).returning();
  return row;
}

const RETRY_STAGE_MINUTES = [1, 5, 30, 180, 720];

export function computeNextRetryAt(attempt: number): Date | null {
  // attempt 是已经失败的次数（1-based）。超出最大重试次数返回 null
  if (attempt >= RETRY_STAGE_MINUTES.length) return null;
  const minutes = RETRY_STAGE_MINUTES[attempt];
  return new Date(Date.now() + minutes * 60 * 1000);
}

export async function updateDeliveryAfterAttempt(id: number, patch: Partial<typeof workflowEventDeliveries.$inferInsert>) {
  await db.update(workflowEventDeliveries).set(patch).where(eq(workflowEventDeliveries.id, id));
}

/** 手动重置投递为 retrying 立即重试 */
export async function retryDelivery(id: number) {
  const tc = tenantCondition(workflowEventDeliveries, currentUser());
  const conds = [eq(workflowEventDeliveries.id, id)];
  if (tc) conds.push(tc);
  const [row] = await db.update(workflowEventDeliveries)
    .set({ status: 'retrying', nextRetryAt: new Date() })
    .where(and(...conds)).returning();
  if (!row) throw new HTTPException(404, { message: '投递记录不存在' });
  return mapDelivery(row);
}

/** 批量重试（按 ids） */
export async function retryDeliveries(ids: number[]) {
  if (ids.length === 0) return 0;
  const tc = tenantCondition(workflowEventDeliveries, currentUser());
  const conds = [inArray(workflowEventDeliveries.id, ids)];
  if (tc) conds.push(tc);
  const rows = await db.update(workflowEventDeliveries)
    .set({ status: 'retrying', nextRetryAt: new Date() })
    .where(and(...conds)).returning({ id: workflowEventDeliveries.id });
  return rows.length;
}
