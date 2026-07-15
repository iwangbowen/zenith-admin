import { randomBytes, createHmac, randomUUID } from 'node:crypto';
import { eq, and, or, desc, ilike, inArray, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { appWebhookSubscriptions, appWebhookDeliveries, oauth2Clients, users } from '../../db/schema';
import type { AppWebhookSubscriptionRow, AppWebhookDeliveryRow } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import { encryptField, decryptField } from '../../lib/encryption';
import { httpPost } from '../../lib/http-client';
import logger from '../../lib/logger';
import { openEventBus } from '../../lib/open-event-bus';
import { mapWithConcurrency } from '../../lib/concurrency';
import { OPEN_WEBHOOK_SIGNATURE_HEADER, OPEN_WEBHOOK_RETRY_STAGES_MINUTES, OPEN_WEBHOOK_EVENTS, OPEN_WEBHOOK_EVENT_LABELS } from '@zenith/shared';
import type { CreateAppWebhookInput, UpdateAppWebhookInput } from '@zenith/shared';
import { config } from '../../config';
import { sendSystemInApp } from '../messaging/in-app-messages.service';

const TIMEOUT_MS = 10_000;
const PENDING_RECOVERY_AFTER_MS = 2 * 60_000;
const RETRY_CONCURRENCY = 10;

/** 可订阅的事件类型元数据（供订阅界面选择） */
export function listWebhookEvents() {
  return OPEN_WEBHOOK_EVENTS.map((code) => ({ code, label: OPEN_WEBHOOK_EVENT_LABELS[code] ?? code }));
}

function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`;
}

function sign(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

// ─── 映射 ─────────────────────────────────────────────────────────────────────

export function mapSubscription(row: AppWebhookSubscriptionRow) {
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    url: row.url,
    signMode: row.signMode as 'hmacSha256' | 'none',
    events: row.events ?? [],
    headers: row.headers ?? null,
    status: row.status,
    hasSecret: Boolean(row.secretEncrypted),
    secretMasked: row.secretEncrypted ? '••••••••' : null,
    lastDeliveryAt: formatNullableDateTime(row.lastDeliveryAt),
    consecutiveFailures: row.consecutiveFailures,
    autoDisabledAt: formatNullableDateTime(row.autoDisabledAt),
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function mapDelivery(row: AppWebhookDeliveryRow) {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    clientId: row.clientId,
    eventType: row.eventType,
    eventId: row.eventId,
    status: row.status as 'pending' | 'success' | 'failed' | 'retrying',
    attempt: row.attempt,
    requestUrl: row.requestUrl ?? null,
    responseStatus: row.responseStatus ?? null,
    responseBody: row.responseBody ?? null,
    errorMessage: row.errorMessage ?? null,
    durationMs: row.durationMs ?? null,
    nextRetryAt: formatNullableDateTime(row.nextRetryAt),
    finishedAt: formatNullableDateTime(row.finishedAt),
    createdAt: formatDateTime(row.createdAt),
  };
}

async function ensureAppExists(clientId: string) {
  const [row] = await db.select({ id: oauth2Clients.id }).from(oauth2Clients).where(eq(oauth2Clients.clientId, clientId)).limit(1);
  if (!row) throw new HTTPException(400, { message: '指定的应用（AppKey）不存在' });
}

// ─── 订阅 CRUD ────────────────────────────────────────────────────────────────

export async function listSubscriptions(opts: {
  page: number;
  pageSize: number;
  clientId?: string;
  status?: 'enabled' | 'disabled';
  keyword?: string;
}) {
  const { page, pageSize, clientId, status, keyword } = opts;
  const conds: SQL[] = [];
  if (clientId) conds.push(eq(appWebhookSubscriptions.clientId, clientId));
  if (status) conds.push(eq(appWebhookSubscriptions.status, status));
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(appWebhookSubscriptions.name, kw), ilike(appWebhookSubscriptions.url, kw)) as SQL);
  }
  const where = conds.length ? and(...conds) : undefined;
  const [list, total] = await Promise.all([
    db.select().from(appWebhookSubscriptions)
      .where(where)
      .orderBy(desc(appWebhookSubscriptions.createdAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.$count(appWebhookSubscriptions, where),
  ]);
  return { list: list.map(mapSubscription), total, page, pageSize };
}

export async function getSubscription(id: number) {
  const [row] = await db.select().from(appWebhookSubscriptions).where(eq(appWebhookSubscriptions.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: 'Webhook 订阅不存在' });
  return mapSubscription(row);
}

export async function getSubscriptionBeforeAudit(id: number) {
  return getSubscription(id);
}

export async function createSubscription(input: CreateAppWebhookInput) {
  await ensureAppExists(input.clientId);
  const signMode = input.signMode ?? 'hmacSha256';
  let secretRaw = '';
  let secretEncrypted: string | null = null;
  if (signMode === 'hmacSha256') {
    secretRaw = generateWebhookSecret();
    secretEncrypted = encryptField(secretRaw);
  }
  const [row] = await db.insert(appWebhookSubscriptions).values({
    clientId: input.clientId,
    name: input.name.trim(),
    url: input.url.trim(),
    secretEncrypted,
    signMode,
    events: input.events ?? [],
    headers: input.headers ?? null,
    status: input.status ?? 'enabled',
  }).returning();
  return { ...mapSubscription(row), secret: secretRaw };
}

export async function updateSubscription(id: number, input: UpdateAppWebhookInput) {
  await getSubscription(id);
  const [row] = await db.update(appWebhookSubscriptions).set({
    name: input.name?.trim(),
    url: input.url?.trim(),
    signMode: input.signMode,
    events: input.events,
    headers: input.headers,
    status: input.status,
    ...(input.status === 'enabled' ? { autoDisabledAt: null } : {}),
  }).where(eq(appWebhookSubscriptions.id, id)).returning();
  return mapSubscription(row);
}

export async function regenerateSubscriptionSecret(id: number) {
  const [row] = await db.select().from(appWebhookSubscriptions).where(eq(appWebhookSubscriptions.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: 'Webhook 订阅不存在' });
  const secretRaw = generateWebhookSecret();
  await db.update(appWebhookSubscriptions).set({
    secretEncrypted: encryptField(secretRaw),
    signMode: 'hmacSha256',
  }).where(eq(appWebhookSubscriptions.id, id));
  return { id, secret: secretRaw };
}

export async function deleteSubscription(id: number) {
  const result = await db.delete(appWebhookSubscriptions).where(eq(appWebhookSubscriptions.id, id)).returning();
  if (result.length === 0) throw new HTTPException(404, { message: 'Webhook 订阅不存在' });
}

// ─── 投递日志 ─────────────────────────────────────────────────────────────────

export async function listDeliveries(opts: {
  page: number;
  pageSize: number;
  subscriptionId?: number;
  clientId?: string;
  status?: 'pending' | 'success' | 'failed' | 'retrying';
  eventType?: string;
}) {
  const { page, pageSize, subscriptionId, clientId, status, eventType } = opts;
  const conds: SQL[] = [];
  if (subscriptionId) conds.push(eq(appWebhookDeliveries.subscriptionId, subscriptionId));
  if (clientId) conds.push(eq(appWebhookDeliveries.clientId, clientId));
  if (status) conds.push(eq(appWebhookDeliveries.status, status));
  if (eventType) conds.push(eq(appWebhookDeliveries.eventType, eventType));
  const where = conds.length ? and(...conds) : undefined;
  const [list, total] = await Promise.all([
    db.select().from(appWebhookDeliveries)
      .where(where)
      .orderBy(desc(appWebhookDeliveries.createdAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.$count(appWebhookDeliveries, where),
  ]);
  return { list: list.map(mapDelivery), total, page, pageSize };
}

export async function getDelivery(id: number) {
  const [row] = await db.select().from(appWebhookDeliveries).where(eq(appWebhookDeliveries.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '投递记录不存在' });
  return mapDelivery(row);
}

/** 手动触发测试投递 */
export async function testSubscription(id: number) {
  const [sub] = await db.select().from(appWebhookSubscriptions).where(eq(appWebhookSubscriptions.id, id)).limit(1);
  if (!sub) throw new HTTPException(404, { message: 'Webhook 订阅不存在' });
  const eventId = randomUUID();
  const delivery = await insertDelivery({
    subscriptionId: sub.id,
    clientId: sub.clientId,
    eventType: 'app.test',
    eventId,
    payload: { type: 'app.test', eventId, clientId: sub.clientId, occurredAt: formatDateTime(new Date()), data: { message: '这是一条 Webhook 测试投递' } },
  });
  queueMicrotask(() => {
    dispatchDelivery(delivery.id).catch((err) => logger.error('[app-webhook] test dispatch failed', { deliveryId: delivery.id, err }));
  });
  return { deliveryId: delivery.id };
}

/** 手动重试一条投递 */
export async function retryDelivery(id: number) {
  const [row] = await db.select().from(appWebhookDeliveries).where(eq(appWebhookDeliveries.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '投递记录不存在' });
  await dispatchDelivery(id);
  return { deliveryId: id };
}

export async function scheduleBatchRetryDeliveries(ids: number[]) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) throw new HTTPException(400, { message: '请选择投递记录' });
  if (uniqueIds.length > 100) throw new HTTPException(400, { message: '单次最多重试 100 条投递记录' });
  const rows = await db.update(appWebhookDeliveries)
    .set({
      status: 'retrying',
      nextRetryAt: new Date(),
      finishedAt: null,
      errorMessage: null,
    })
    .where(and(
      inArray(appWebhookDeliveries.id, uniqueIds),
      ne(appWebhookDeliveries.status, 'success'),
    ))
    .returning({ id: appWebhookDeliveries.id });
  return { scheduled: rows.length };
}

// ─── 内部：投递执行 ───────────────────────────────────────────────────────────

interface InsertDeliveryInput {
  subscriptionId: number;
  clientId: string;
  eventType: string;
  eventId: string;
  payload: unknown;
}

async function insertDelivery(input: InsertDeliveryInput): Promise<AppWebhookDeliveryRow> {
  const [row] = await db.insert(appWebhookDeliveries).values({
    subscriptionId: input.subscriptionId,
    clientId: input.clientId,
    eventType: input.eventType,
    eventId: input.eventId,
    payload: input.payload,
    status: 'pending',
  }).returning();
  return row;
}

async function updateDeliveryAfterAttempt(id: number, patch: Partial<AppWebhookDeliveryRow>) {
  await db.update(appWebhookDeliveries).set(patch).where(eq(appWebhookDeliveries.id, id));
}

async function handleTerminalFailure(
  sub: AppWebhookSubscriptionRow,
  delivery: AppWebhookDeliveryRow,
  errorMessage: string,
): Promise<void> {
  if (delivery.eventType === 'app.test') return;

  const [updated] = await db.update(appWebhookSubscriptions)
    .set({ consecutiveFailures: sql`${appWebhookSubscriptions.consecutiveFailures} + 1` })
    .where(eq(appWebhookSubscriptions.id, sub.id))
    .returning({
      consecutiveFailures: appWebhookSubscriptions.consecutiveFailures,
      status: appWebhookSubscriptions.status,
    });
  if (!updated) return;

  const threshold = config.openPlatform.webhookAutoDisableFailures;
  const autoDisabled = updated.status === 'enabled' && updated.consecutiveFailures >= threshold;
  if (autoDisabled) {
    await db.update(appWebhookSubscriptions)
      .set({ status: 'disabled', autoDisabledAt: new Date() })
      .where(eq(appWebhookSubscriptions.id, sub.id));
  }

  const [owner] = await db.select({
    userId: oauth2Clients.ownerId,
    tenantId: users.tenantId,
  })
    .from(oauth2Clients)
    .leftJoin(users, eq(oauth2Clients.ownerId, users.id))
    .where(eq(oauth2Clients.clientId, sub.clientId))
    .limit(1);
  if (!owner?.userId) return;

  const title = autoDisabled ? 'Webhook 已因连续失败自动停用' : 'Webhook 投递失败';
  const content = autoDisabled
    ? `订阅「${sub.name}」连续 ${updated.consecutiveFailures} 次投递失败，已自动停用。最近错误：${errorMessage}`
    : `订阅「${sub.name}」的事件 ${delivery.eventType} 投递最终失败。错误：${errorMessage}`;
  await sendSystemInApp({
    userIds: [owner.userId],
    title,
    content,
    type: autoDisabled ? 'error' : 'warning',
    tenantId: owner.tenantId,
  }).catch((err) => logger.error('[app-webhook] failure alert failed', {
    subscriptionId: sub.id,
    deliveryId: delivery.id,
    err,
  }));
}

/** attempt 为已完成的尝试次数（1-indexed）；超出重试阶梯返回 null */
export function computeNextRetryAt(attempt: number): Date | null {
  if (attempt >= OPEN_WEBHOOK_RETRY_STAGES_MINUTES.length) return null;
  return new Date(Date.now() + OPEN_WEBHOOK_RETRY_STAGES_MINUTES[attempt] * 60_000);
}

export async function dispatchDelivery(deliveryId: number): Promise<void> {
  const [delivery] = await db.select().from(appWebhookDeliveries).where(eq(appWebhookDeliveries.id, deliveryId)).limit(1);
  if (!delivery) return;
  const [sub] = await db.select().from(appWebhookSubscriptions).where(eq(appWebhookSubscriptions.id, delivery.subscriptionId)).limit(1);
  if (!sub || sub.status !== 'enabled') {
    await updateDeliveryAfterAttempt(deliveryId, { status: 'failed', errorMessage: '订阅已被删除或禁用', finishedAt: new Date() });
    return;
  }

  const attempt = delivery.attempt + 1;
  const bodyStr = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Zenith-Event': delivery.eventType,
    'X-Zenith-Event-Id': delivery.eventId,
    'X-Zenith-Delivery-Id': String(delivery.id),
    'X-Zenith-Attempt': String(attempt),
    ...(sub.headers ?? {}),
  };
  if (sub.signMode === 'hmacSha256' && sub.secretEncrypted) {
    const secret = decryptField(sub.secretEncrypted);
    if (secret) headers[OPEN_WEBHOOK_SIGNATURE_HEADER] = `t=${timestamp},v1=${sign(secret, timestamp, bodyStr)}`;
  }

  await updateDeliveryAfterAttempt(deliveryId, { attempt, status: 'pending', requestUrl: sub.url, startedAt: new Date() });

  const t0 = Date.now();
  try {
    const resp = await httpPost(sub.url, bodyStr, { headers, timeout: TIMEOUT_MS });
    const durationMs = Date.now() - t0;
    const respText = await resp.text().catch(() => '');
    await db.update(appWebhookSubscriptions).set({ lastDeliveryAt: new Date() }).where(eq(appWebhookSubscriptions.id, sub.id));
    if (resp.ok) {
      await db.update(appWebhookSubscriptions)
        .set({ consecutiveFailures: 0 })
        .where(eq(appWebhookSubscriptions.id, sub.id));
      await updateDeliveryAfterAttempt(deliveryId, {
        status: 'success',
        responseStatus: resp.status,
        responseBody: respText.slice(0, 4096),
        durationMs,
        finishedAt: new Date(),
        errorMessage: null,
        nextRetryAt: null,
      });
      return;
    }
    const nextRetryAt = computeNextRetryAt(attempt);
    await updateDeliveryAfterAttempt(deliveryId, {
      status: nextRetryAt ? 'retrying' : 'failed',
      responseStatus: resp.status,
      responseBody: respText.slice(0, 4096),
      durationMs,
      errorMessage: `HTTP ${resp.status}`,
      nextRetryAt,
      finishedAt: nextRetryAt ? null : new Date(),
    });
    if (!nextRetryAt) await handleTerminalFailure(sub, delivery, `HTTP ${resp.status}`);
  } catch (err) {
    const durationMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    const nextRetryAt = computeNextRetryAt(attempt);
    await updateDeliveryAfterAttempt(deliveryId, {
      status: nextRetryAt ? 'retrying' : 'failed',
      errorMessage: msg.slice(0, 1024),
      durationMs,
      nextRetryAt,
      finishedAt: nextRetryAt ? null : new Date(),
    });
    if (!nextRetryAt) await handleTerminalFailure(sub, delivery, msg.slice(0, 1024));
  }
}

async function findMatchingSubscriptions(clientId: string, eventType: string): Promise<AppWebhookSubscriptionRow[]> {
  const rows = await db.select().from(appWebhookSubscriptions)
    .where(and(eq(appWebhookSubscriptions.clientId, clientId), eq(appWebhookSubscriptions.status, 'enabled')));
  return rows.filter((s) => (s.events ?? []).length === 0 || (s.events ?? []).includes(eventType));
}

/** 注册开放平台事件总线订阅者：事件 → 匹配订阅 → 投递 */
export function registerOpenWebhookSubscriber(): void {
  openEventBus.onAny(async (event) => {
    try {
      const subs = await findMatchingSubscriptions(event.clientId, event.type);
      for (const sub of subs) {
        const delivery = await insertDelivery({
          subscriptionId: sub.id,
          clientId: event.clientId,
          eventType: event.type,
          eventId: event.eventId,
          payload: event,
        });
        queueMicrotask(() => {
          dispatchDelivery(delivery.id).catch((err) => logger.error('[app-webhook] dispatch failed', { deliveryId: delivery.id, err }));
        });
      }
    } catch (err) {
      logger.error('[app-webhook] subscriber error', { eventId: event.eventId, err });
    }
  });
  logger.info('[app-webhook] subscriber registered');
}

/** 由定时任务调用：扫描到期重试的投递并触发派发 */
export async function retryAppWebhookDeliveries(): Promise<{ retried: number }> {
  const now = new Date();
  const pendingCutoff = new Date(now.getTime() - PENDING_RECOVERY_AFTER_MS);
  const rows = await db.select().from(appWebhookDeliveries)
    .where(or(
      and(
        eq(appWebhookDeliveries.status, 'retrying'),
        lte(appWebhookDeliveries.nextRetryAt, now),
      ),
      and(
        eq(appWebhookDeliveries.status, 'pending'),
        lte(appWebhookDeliveries.createdAt, pendingCutoff),
        or(
          isNull(appWebhookDeliveries.startedAt),
          lte(appWebhookDeliveries.startedAt, pendingCutoff),
        ),
      ),
    ))
    .limit(100);
  await mapWithConcurrency(rows, RETRY_CONCURRENCY, async (row) => dispatchDelivery(row.id));
  return { retried: rows.length };
}
