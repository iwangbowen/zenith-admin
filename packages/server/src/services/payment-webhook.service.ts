/**
 * 支付业务方 Webhook Service。
 * 配置业务系统回调端点，监听支付/退款事件，HMAC 签名后 HTTP 推送，
 * 失败自动重试（指数退避，cron 兜底），并留存投递日志。
 */
import { and, desc, eq, inArray, like, lte, or, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { createHmac } from 'node:crypto';
import { db } from '../db';
import {
  paymentWebhookEndpoints,
  paymentWebhookDeliveries,
  type PaymentWebhookEndpointRow,
  type PaymentWebhookDeliveryRow,
} from '../db/schema';
import { currentUser } from '../lib/context';
import { getCreateTenantId, tenantCondition } from '../lib/tenant';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { encryptField, decryptField } from '../lib/encryption';
import { httpPost } from '../lib/http-client';
import { paymentEventBus, type PaymentEvent } from '../lib/payment-event-bus';
import logger from '../lib/logger';
import type { PaymentWebhookEndpoint, PaymentWebhookDelivery } from '@zenith/shared';

const MAX_ATTEMPTS = 5;

export function mapEndpoint(row: PaymentWebhookEndpointRow): PaymentWebhookEndpoint {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    bizType: row.bizType ?? null,
    events: row.events ?? [],
    status: row.status,
    hasSecret: Boolean(row.secretEncrypted),
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapDelivery(row: PaymentWebhookDeliveryRow & { endpointName?: string | null }): PaymentWebhookDelivery {
  return {
    id: row.id,
    endpointId: row.endpointId,
    endpointName: row.endpointName ?? null,
    eventType: row.eventType,
    orderNo: row.orderNo ?? null,
    payload: row.payload ?? null,
    status: row.status,
    attempts: row.attempts,
    httpStatus: row.httpStatus ?? null,
    responseBody: row.responseBody ?? null,
    lastError: row.lastError ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 端点 CRUD ──────────────────────────────────────────────────────────────
export interface ListEndpointsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'enabled' | 'disabled';
}

export async function listEndpoints(q: ListEndpointsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  if (q.keyword) conds.push(like(paymentWebhookEndpoints.name, `%${escapeLike(q.keyword)}%`));
  if (q.status) conds.push(eq(paymentWebhookEndpoints.status, q.status));
  const where = mergeWhere(conds.length ? and(...conds) : undefined, tenantCondition(paymentWebhookEndpoints, currentUser()));
  const [total, list] = await Promise.all([
    db.$count(paymentWebhookEndpoints, where),
    withPagination(db.select().from(paymentWebhookEndpoints).where(where).orderBy(desc(paymentWebhookEndpoints.id)).$dynamic(), page, pageSize),
  ]);
  return { list: list.map(mapEndpoint), total, page, pageSize };
}

async function ensureEndpoint(id: number): Promise<PaymentWebhookEndpointRow> {
  const tc = tenantCondition(paymentWebhookEndpoints, currentUser());
  const [row] = await db.select().from(paymentWebhookEndpoints).where(and(eq(paymentWebhookEndpoints.id, id), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: 'Webhook 端点不存在' });
  return row;
}

export async function getEndpoint(id: number): Promise<PaymentWebhookEndpoint> {
  return mapEndpoint(await ensureEndpoint(id));
}

export interface UpsertEndpointInput {
  name: string;
  url: string;
  bizType?: string;
  events?: string[];
  status?: 'enabled' | 'disabled';
  secret?: string;
  remark?: string;
}

export async function createEndpoint(input: UpsertEndpointInput): Promise<PaymentWebhookEndpoint> {
  const [row] = await db
    .insert(paymentWebhookEndpoints)
    .values({
      name: input.name,
      url: input.url,
      bizType: input.bizType || null,
      events: input.events ?? [],
      status: input.status ?? 'enabled',
      secretEncrypted: input.secret ? encryptField(input.secret) : null,
      remark: input.remark ?? null,
      tenantId: getCreateTenantId(currentUser()),
    })
    .returning();
  return mapEndpoint(row);
}

export async function updateEndpoint(id: number, input: Partial<UpsertEndpointInput>): Promise<PaymentWebhookEndpoint> {
  await ensureEndpoint(id);
  const set: Partial<PaymentWebhookEndpointRow> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.url !== undefined) set.url = input.url;
  if (input.bizType !== undefined) set.bizType = input.bizType || null;
  if (input.events !== undefined) set.events = input.events;
  if (input.status !== undefined) set.status = input.status;
  if (input.remark !== undefined) set.remark = input.remark;
  if (input.secret) set.secretEncrypted = encryptField(input.secret);
  const tc = tenantCondition(paymentWebhookEndpoints, currentUser());
  const [row] = await db.update(paymentWebhookEndpoints).set(set).where(and(eq(paymentWebhookEndpoints.id, id), tc)).returning();
  return mapEndpoint(row);
}

export async function deleteEndpoint(id: number): Promise<void> {
  await ensureEndpoint(id);
  await db.delete(paymentWebhookEndpoints).where(eq(paymentWebhookEndpoints.id, id));
}

// ─── 投递日志 ───────────────────────────────────────────────────────────────
export interface ListDeliveriesQuery {
  page?: number;
  pageSize?: number;
  endpointId?: number;
  status?: 'pending' | 'success' | 'failed';
  keyword?: string;
}

export async function listDeliveries(q: ListDeliveriesQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  if (q.endpointId) conds.push(eq(paymentWebhookDeliveries.endpointId, q.endpointId));
  if (q.status) conds.push(eq(paymentWebhookDeliveries.status, q.status));
  if (q.keyword) conds.push(like(paymentWebhookDeliveries.orderNo, `%${escapeLike(q.keyword)}%`));
  const where = mergeWhere(conds.length ? and(...conds) : undefined, tenantCondition(paymentWebhookDeliveries, currentUser()));
  const [total, rows] = await Promise.all([
    db.$count(paymentWebhookDeliveries, where),
    db.query.paymentWebhookDeliveries.findMany({
      where,
      orderBy: desc(paymentWebhookDeliveries.id),
      limit: pageSize,
      offset: (page - 1) * pageSize,
      with: { endpoint: { columns: { name: true } } },
    }),
  ]);
  const list = rows.map((r) => mapDelivery({ ...r, endpointName: r.endpoint?.name ?? null }));
  return { list, total, page, pageSize };
}

// ─── 投递与重试 ─────────────────────────────────────────────────────────────
function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** attempts, 3_600_000);
}

/** 发送单条投递记录（更新其状态）。 */
async function sendDelivery(delivery: PaymentWebhookDeliveryRow, endpoint: PaymentWebhookEndpointRow): Promise<void> {
  const secret = decryptField(endpoint.secretEncrypted) ?? '';
  const attempts = delivery.attempts + 1;
  try {
    const res = await httpPost(endpoint.url, delivery.payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Payment-Event': delivery.eventType,
        'X-Payment-Signature': secret ? sign(secret, delivery.payload) : '',
      },
    });
    const body = (await res.text()).slice(0, 1000);
    if (res.ok) {
      await db.update(paymentWebhookDeliveries).set({ status: 'success', attempts, httpStatus: res.status, responseBody: body, lastError: null, nextRetryAt: null }).where(eq(paymentWebhookDeliveries.id, delivery.id));
    } else {
      await markDeliveryFailed(delivery.id, attempts, res.status, body, `HTTP ${res.status}`);
    }
  } catch (err) {
    await markDeliveryFailed(delivery.id, attempts, null, null, err instanceof Error ? err.message : '投递异常');
  }
}

async function markDeliveryFailed(id: number, attempts: number, httpStatus: number | null, body: string | null, lastError: string): Promise<void> {
  const exhausted = attempts >= MAX_ATTEMPTS;
  await db
    .update(paymentWebhookDeliveries)
    .set({
      status: 'failed',
      attempts,
      httpStatus,
      responseBody: body,
      lastError: lastError.slice(0, 500),
      nextRetryAt: exhausted ? null : new Date(Date.now() + backoffMs(attempts)),
    })
    .where(eq(paymentWebhookDeliveries.id, id));
}

/** 事件分发：为匹配的启用端点创建投递记录并立即尝试发送。 */
async function dispatchEvent(event: PaymentEvent): Promise<void> {
  const endpoints = await db
    .select()
    .from(paymentWebhookEndpoints)
    .where(and(eq(paymentWebhookEndpoints.status, 'enabled'), or(isNull(paymentWebhookEndpoints.bizType), eq(paymentWebhookEndpoints.bizType, event.bizType))));
  for (const ep of endpoints) {
    const events = ep.events ?? [];
    if (events.length > 0 && !events.includes(event.type)) continue;
    const payload = JSON.stringify(event);
    const [delivery] = await db
      .insert(paymentWebhookDeliveries)
      .values({ endpointId: ep.id, eventType: event.type, orderNo: event.orderNo, payload, status: 'pending', tenantId: ep.tenantId })
      .returning();
    void sendDelivery(delivery, ep).catch((err) => logger.error('[payment-webhook] send failed', { id: delivery.id, err }));
  }
}

/** Cron 兜底：重投所有 failed 且未超上限、已到重试时间的投递。返回处理条数。 */
export async function retryPendingDeliveries(): Promise<number> {
  const now = new Date();
  const rows = await db
    .select()
    .from(paymentWebhookDeliveries)
    .where(and(inArray(paymentWebhookDeliveries.status, ['pending', 'failed']), lte(paymentWebhookDeliveries.attempts, MAX_ATTEMPTS - 1), or(isNull(paymentWebhookDeliveries.nextRetryAt), lte(paymentWebhookDeliveries.nextRetryAt, now))))
    .limit(100);
  for (const row of rows) {
    const [ep] = await db.select().from(paymentWebhookEndpoints).where(eq(paymentWebhookEndpoints.id, row.endpointId)).limit(1);
    if (ep && ep.status === 'enabled') await sendDelivery(row, ep);
  }
  return rows.length;
}

/** 手动重投单条投递记录。 */
export async function redeliver(id: number): Promise<PaymentWebhookDelivery> {
  const tc = tenantCondition(paymentWebhookDeliveries, currentUser());
  const [row] = await db.select().from(paymentWebhookDeliveries).where(and(eq(paymentWebhookDeliveries.id, id), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '投递记录不存在' });
  const [ep] = await db.select().from(paymentWebhookEndpoints).where(eq(paymentWebhookEndpoints.id, row.endpointId)).limit(1);
  if (!ep) throw new HTTPException(404, { message: 'Webhook 端点不存在' });
  await sendDelivery(row, ep);
  const [latest] = await db.select().from(paymentWebhookDeliveries).where(eq(paymentWebhookDeliveries.id, id)).limit(1);
  return mapDelivery(latest ?? row);
}

let registered = false;
/** 注册 Webhook 事件订阅者（监听全部支付事件并分发到业务方端点）。 */
export function registerWebhookSubscribers(): void {
  if (registered) return;
  registered = true;
  paymentEventBus.onAny((event) => {
    void dispatchEvent(event).catch((err) => logger.error('[payment-webhook] dispatch failed', { type: event.type, err }));
  });
  logger.info('Payment webhook subscribers registered');
}
