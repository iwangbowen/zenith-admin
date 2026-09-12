import { randomBytes, createHmac, randomUUID } from 'node:crypto';
import { buildListResult } from '../../lib/list-query';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { eq, and, or, desc, inArray, isNotNull, isNull, lte, sql, arrayContained, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { appWebhookSubscriptions, appWebhookDeliveries, cmsOpenAppGrants, oauth2Clients, users } from '../../db/schema';
import type { AppWebhookSubscriptionRow, AppWebhookDeliveryRow } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime, formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { encryptField, decryptField } from '../../lib/encryption';
import { httpPost, type HttpResponse } from '../../lib/http-client';
import logger from '../../lib/logger';
import { openEventBus, type OpenPlatformEvent } from '../../lib/open-event-bus';
import { mapWithConcurrency } from '../../lib/concurrency';
import { OPEN_WEBHOOK_SIGNATURE_HEADER, OPEN_WEBHOOK_RETRY_STAGES_MINUTES, OPEN_WEBHOOK_EVENTS, OPEN_WEBHOOK_EVENT_LABELS, PAYMENT_WEBHOOK_EVENTS } from '@zenith/shared/open-platform';
import type { CreateAppWebhookInput, UpdateAppWebhookInput } from '@zenith/shared/open-platform';
import { DRIVE_OPEN_EVENTS } from '@zenith/shared/drive';
import { config } from '../../config';
import { assertSafeOutboundUrl } from '../../lib/outbound-url';
import { notify } from '../messaging/notification-outbox.service';
import { currentUser } from '../../lib/context';
import { getCreateTenantId, exactTenantCondition, optionalExactTenantCondition } from '../../lib/tenant';

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BODY_BYTES = 4096;
const PENDING_RECOVERY_AFTER_MS = 2 * 60_000;
const RETRY_CONCURRENCY = 10;
/** 必须 HMAC 签名的事件：支付 / 退款，以及携带内部文件元数据的网盘事件 */
const SENSITIVE_WEBHOOK_EVENTS = new Set<string>([...PAYMENT_WEBHOOK_EVENTS, ...DRIVE_OPEN_EVENTS]);

export type AppWebhookDomain = 'all' | 'payment';

function currentTenantId(): number | null {
  return getCreateTenantId(currentUser());
}

function isSensitiveWebhookEvent(eventType: string): boolean {
  return SENSITIVE_WEBHOOK_EVENTS.has(eventType);
}

function assertCustomHeaders(headers: Record<string, string> | null | undefined): void {
  for (const key of Object.keys(headers ?? {})) {
    const normalized = key.trim().toLowerCase();
    if (normalized === 'content-type' || normalized.startsWith('x-zenith-')) {
      throw new HTTPException(400, { message: `自定义请求头不能覆盖保留头：${key}` });
    }
  }
}

function assertSubscriptionPolicy(input: {
  events: readonly string[];
  signMode: 'hmacSha256' | 'none';
  hasSecret: boolean;
  headers?: Record<string, string> | null;
}): void {
  assertCustomHeaders(input.headers);
  if (input.events.some(isSensitiveWebhookEvent) && input.signMode !== 'hmacSha256') {
    throw new HTTPException(400, { message: '支付、退款与网盘事件必须使用 HMAC-SHA256 签名' });
  }
  if (input.signMode === 'hmacSha256' && !input.hasSecret) {
    throw new HTTPException(400, { message: 'HMAC 签名密钥不可用，请先重置 Webhook 密钥' });
  }
}

function clientTenantScope(tenantId: number | null): SQL {
  return exactTenantCondition(oauth2Clients.tenantId, tenantId);
}

function subscriptionDomainScope(domain: AppWebhookDomain): SQL | undefined {
  if (domain !== 'payment') return undefined;
  return and(
    sql`cardinality(${appWebhookSubscriptions.events}) > 0`,
    arrayContained(appWebhookSubscriptions.events, [...PAYMENT_WEBHOOK_EVENTS]),
  );
}

function assertDomainEvents(events: readonly string[], domain: AppWebhookDomain): void {
  if (domain !== 'payment') return;
  if (events.length === 0 || events.some((event) => !PAYMENT_EVENT_SET.has(event))) {
    throw new HTTPException(400, { message: '支付中心 Webhook 必须显式选择支付或退款事件' });
  }
}

const PAYMENT_EVENT_SET = new Set<string>(PAYMENT_WEBHOOK_EVENTS);

function externalSubscriptionScope(tenantId: number | null, domain: AppWebhookDomain = 'all'): SQL {
  const clientIds = db
    .select({ clientId: oauth2Clients.clientId })
    .from(oauth2Clients)
    .where(clientTenantScope(tenantId));
  return and(
    exactTenantCondition(appWebhookSubscriptions.tenantId, tenantId),
    eq(appWebhookSubscriptions.internal, false),
    isNotNull(appWebhookSubscriptions.clientId),
    inArray(appWebhookSubscriptions.clientId, clientIds),
    subscriptionDomainScope(domain),
  )!;
}

function externalDeliveryScope(tenantId: number | null, domain: AppWebhookDomain = 'all'): SQL {
  const subscriptionIds = db
    .select({ id: appWebhookSubscriptions.id })
    .from(appWebhookSubscriptions)
    .where(externalSubscriptionScope(tenantId, domain));
  return and(
    exactTenantCondition(appWebhookDeliveries.tenantId, tenantId),
    inArray(appWebhookDeliveries.subscriptionId, subscriptionIds),
  )!;
}

/** 可订阅的事件类型元数据（供订阅界面选择） */
export function listWebhookEvents(domain: AppWebhookDomain = 'all') {
  const events = domain === 'payment' ? PAYMENT_WEBHOOK_EVENTS : OPEN_WEBHOOK_EVENTS;
  return events.map((code) => ({ code, label: OPEN_WEBHOOK_EVENT_LABELS[code] ?? code }));
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
    tenantId: row.tenantId ?? null,
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
    ...formatTimestamps(row),
  };
}

function mapDelivery(row: AppWebhookDeliveryRow) {
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    clientId: row.clientId,
    tenantId: row.tenantId ?? null,
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

async function ensureAppExists(clientId: string, tenantId: number | null) {
  return requireFirstRow(
    db
      .select({ id: oauth2Clients.id, tenantId: oauth2Clients.tenantId })
      .from(oauth2Clients)
      .where(and(eq(oauth2Clients.clientId, clientId), clientTenantScope(tenantId)))
      .limit(1),
    '指定的应用（AppKey）不存在', 400,
  );
}

async function getExternalSubscriptionRow(
  id: number,
  tenantId = currentTenantId(),
  domain: AppWebhookDomain = 'all',
): Promise<AppWebhookSubscriptionRow> {
  return requireFirstRow(
    db
      .select()
      .from(appWebhookSubscriptions)
      .where(and(eq(appWebhookSubscriptions.id, id), externalSubscriptionScope(tenantId, domain)))
      .limit(1),
    'Webhook 订阅不存在',
  );
}

async function getExternalDeliveryRow(
  id: number,
  tenantId = currentTenantId(),
  domain: AppWebhookDomain = 'all',
): Promise<AppWebhookDeliveryRow> {
  return requireFirstRow(
    db
      .select()
      .from(appWebhookDeliveries)
      .where(and(eq(appWebhookDeliveries.id, id), externalDeliveryScope(tenantId, domain)))
      .limit(1),
    '投递记录不存在',
  );
}

// ─── 订阅 CRUD ────────────────────────────────────────────────────────────────

export async function listSubscriptions(opts: {
  page: number;
  pageSize: number;
  clientId?: string;
  status?: 'enabled' | 'disabled';
  keyword?: string;
}, domain: AppWebhookDomain = 'all') {
  const { page, pageSize, clientId, status, keyword } = opts;
  const tenantId = currentTenantId();
  const where = buildWhere(
    externalSubscriptionScope(tenantId, domain),
    clientId ? eq(appWebhookSubscriptions.clientId, clientId) : undefined,
    status ? eq(appWebhookSubscriptions.status, status) : undefined,
    keywordCondition(keyword, [appWebhookSubscriptions.name, appWebhookSubscriptions.url], 'ilike'),
  );
  return buildListResult({
    page: page,
    pageSize: pageSize,
    count: () => db.$count(appWebhookSubscriptions, where),
    rows: () => db.select().from(appWebhookSubscriptions)
  .where(where)
  .orderBy(desc(appWebhookSubscriptions.createdAt))
  .limit(pageSize)
  .offset(pageOffset(page, pageSize)),
    map: mapSubscription,
  });
}

export async function getSubscription(id: number, domain: AppWebhookDomain = 'all') {
  return mapSubscription(await getExternalSubscriptionRow(id, currentTenantId(), domain));
}

export async function getSubscriptionBeforeAudit(id: number, domain: AppWebhookDomain = 'all') {
  return getSubscription(id, domain);
}

/**
 * 创建 / 更新订阅时即时校验回调地址。
 *
 * 不校验的话，内网地址在保存时一路绿灯，直到第一次投递才被 SSRF 防护拒绝——
 * 用户要翻投递日志才知道地址根本不可用。这里提前把同一套规则跑一遍，把错误
 * 反馈到表单上。开发环境可通过 OPEN_WEBHOOK_ALLOWED_HOSTS 放行本地回调地址，
 * 否则本地根本无法端到端验证投递链路。
 */
async function assertWebhookUrlReachable(rawUrl: string): Promise<void> {
  await assertSafeOutboundUrl(rawUrl, config.openPlatform.webhookAllowedHosts);
}

export async function createSubscription(input: CreateAppWebhookInput, domain: AppWebhookDomain = 'all') {
  const tenantId = currentTenantId();
  await ensureAppExists(input.clientId, tenantId);
  await assertWebhookUrlReachable(input.url.trim());
  const signMode = input.signMode ?? 'hmacSha256';
  const events = input.events ?? [];
  assertDomainEvents(events, domain);
  let secretRaw = '';
  let secretEncrypted: string | null = null;
  if (signMode === 'hmacSha256') {
    secretRaw = generateWebhookSecret();
    secretEncrypted = encryptField(secretRaw);
  }
  assertSubscriptionPolicy({
    events,
    signMode,
    hasSecret: Boolean(secretEncrypted),
    headers: input.headers,
  });
  const [row] = await db.insert(appWebhookSubscriptions).values({
    clientId: input.clientId,
    name: input.name.trim(),
    url: input.url.trim(),
    secretEncrypted,
    signMode,
    events,
    headers: input.headers ?? null,
    status: input.status ?? 'enabled',
    tenantId,
  }).returning();
  return { ...mapSubscription(row), secret: secretRaw };
}

export async function updateSubscription(id: number, input: UpdateAppWebhookInput, domain: AppWebhookDomain = 'all') {
  const existing = await getExternalSubscriptionRow(id, currentTenantId(), domain);
  if (input.url !== undefined) await assertWebhookUrlReachable(input.url.trim());
  const signMode = input.signMode ?? existing.signMode;
  const events = input.events ?? existing.events;
  assertDomainEvents(events, domain);
  const headers = input.headers ?? existing.headers;
  const hasSecret = signMode === 'hmacSha256' && Boolean(existing.secretEncrypted);
  assertSubscriptionPolicy({ events, signMode, hasSecret, headers });
  const [row] = await db.update(appWebhookSubscriptions).set({
    name: input.name?.trim(),
    url: input.url?.trim(),
    signMode: input.signMode,
    ...(input.signMode === 'none' ? { secretEncrypted: null } : {}),
    events: input.events,
    headers: input.headers,
    status: input.status,
    ...(input.status === 'enabled' ? { autoDisabledAt: null } : {}),
  }).where(and(eq(appWebhookSubscriptions.id, id), externalSubscriptionScope(existing.tenantId ?? null, domain))).returning();
  requireRow(row, 'Webhook 订阅状态已变化，请刷新后重试', 409);
  return mapSubscription(row);
}

export async function regenerateSubscriptionSecret(id: number, domain: AppWebhookDomain = 'all') {
  const row = await getExternalSubscriptionRow(id, currentTenantId(), domain);
  const secretRaw = generateWebhookSecret();
  await db.update(appWebhookSubscriptions).set({
    secretEncrypted: encryptField(secretRaw),
    signMode: 'hmacSha256',
  }).where(and(eq(appWebhookSubscriptions.id, id), externalSubscriptionScope(row.tenantId ?? null, domain)));
  return { id, secret: secretRaw };
}

export async function deleteSubscription(id: number, domain: AppWebhookDomain = 'all') {
  const row = await getExternalSubscriptionRow(id, currentTenantId(), domain);
  const result = await db.delete(appWebhookSubscriptions)
    .where(and(eq(appWebhookSubscriptions.id, id), externalSubscriptionScope(row.tenantId ?? null, domain)))
    .returning();
  requireRow(result[0], 'Webhook 订阅不存在');
}

// ─── 投递日志 ─────────────────────────────────────────────────────────────────

export async function listDeliveries(opts: {
  page: number;
  pageSize: number;
  subscriptionId?: number;
  clientId?: string;
  status?: 'pending' | 'success' | 'failed' | 'retrying';
  eventType?: string;
}, domain: AppWebhookDomain = 'all') {
  const { page, pageSize, subscriptionId, clientId, status, eventType } = opts;
  const tenantId = currentTenantId();
  const where = buildWhere(
    externalDeliveryScope(tenantId, domain),
    subscriptionId ? eq(appWebhookDeliveries.subscriptionId, subscriptionId) : undefined,
    clientId ? eq(appWebhookDeliveries.clientId, clientId) : undefined,
    status ? eq(appWebhookDeliveries.status, status) : undefined,
    eventType ? eq(appWebhookDeliveries.eventType, eventType) : undefined,
  );
  return buildListResult({
    page: page,
    pageSize: pageSize,
    count: () => db.$count(appWebhookDeliveries, where),
    rows: () => db.select().from(appWebhookDeliveries)
  .where(where)
  .orderBy(desc(appWebhookDeliveries.createdAt))
  .limit(pageSize)
  .offset(pageOffset(page, pageSize)),
    map: mapDelivery,
  });
}

export async function getDelivery(id: number, domain: AppWebhookDomain = 'all') {
  return mapDelivery(await getExternalDeliveryRow(id, currentTenantId(), domain));
}

/** 手动触发测试投递 */
export async function testSubscription(id: number, domain: AppWebhookDomain = 'all') {
  const sub = await getExternalSubscriptionRow(id, currentTenantId(), domain);
  if (!sub.clientId) throw new HTTPException(409, { message: 'Webhook 订阅缺少所属应用' });
  const eventId = randomUUID();
  const delivery = requireRow(await insertDelivery({
    subscriptionId: sub.id,
    clientId: sub.clientId,
    tenantId: sub.tenantId ?? null,
    eventType: 'app.test',
    eventId,
    payload: { type: 'app.test', eventId, clientId: sub.clientId, occurredAt: formatDateTime(new Date()), data: { message: '这是一条 Webhook 测试投递' } },
  }), '测试事件已存在，请重试', 409);
  queueMicrotask(() => {
    dispatchDelivery(delivery.id, sub.tenantId ?? null).catch((err) => logger.error('[app-webhook] test dispatch failed', { deliveryId: delivery.id, err }));
  });
  return { deliveryId: delivery.id };
}

/** 手动重试一条投递 */
export async function retryDelivery(id: number, domain: AppWebhookDomain = 'all') {
  const row = await getExternalDeliveryRow(id, currentTenantId(), domain);
  if (row.status !== 'failed') throw new HTTPException(400, { message: '仅最终失败的投递可手动重试' });
  const claimed = await dispatchDelivery(id, row.tenantId ?? null);
  requireRow(claimed, '投递已被其他任务处理，请刷新后重试', 409);
  return { deliveryId: id };
}

export async function scheduleBatchRetryDeliveries(ids: number[], domain: AppWebhookDomain = 'all') {
  const uniqueIds = [...new Set(ids)];
  requireRow(uniqueIds[0], '请选择投递记录', 400);
  if (uniqueIds.length > 100) throw new HTTPException(400, { message: '单次最多重试 100 条投递记录' });
  const tenantId = currentTenantId();
  const rows = await db.update(appWebhookDeliveries)
    .set({
      status: 'retrying',
      nextRetryAt: new Date(),
      finishedAt: null,
      errorMessage: null,
    })
    .where(and(
      inArray(appWebhookDeliveries.id, uniqueIds),
      eq(appWebhookDeliveries.status, 'failed'),
      externalDeliveryScope(tenantId, domain),
    ))
    .returning({ id: appWebhookDeliveries.id });
  return { scheduled: rows.length };
}

// ─── 内部：投递执行 ───────────────────────────────────────────────────────────

interface InsertDeliveryInput {
  subscriptionId: number;
  clientId: string | null;
  tenantId: number | null;
  eventType: string;
  eventId: string;
  payload: unknown;
}

async function insertDelivery(input: InsertDeliveryInput): Promise<AppWebhookDeliveryRow | null> {
  const [row] = await db.insert(appWebhookDeliveries).values({
    subscriptionId: input.subscriptionId,
    clientId: input.clientId,
    tenantId: input.tenantId,
    eventType: input.eventType,
    eventId: input.eventId,
    payload: input.payload,
    status: 'pending',
  }).onConflictDoNothing({
    target: [appWebhookDeliveries.subscriptionId, appWebhookDeliveries.eventId],
  }).returning();
  return row ?? null;
}

async function updateDeliveryAfterAttempt(
  id: number,
  patch: Partial<AppWebhookDeliveryRow>,
  expectedAttempt?: number,
  tenantId?: number | null,
): Promise<boolean> {
  const where = and(
    eq(appWebhookDeliveries.id, id),
    expectedAttempt === undefined ? undefined : eq(appWebhookDeliveries.attempt, expectedAttempt),
    optionalExactTenantCondition(appWebhookDeliveries.tenantId, tenantId),
  );
  const rows = await db.update(appWebhookDeliveries).set(patch).where(where).returning({ id: appWebhookDeliveries.id });
  return rows.length > 0;
}

async function readResponseTextWithTimeout(response: HttpResponse): Promise<string> {
  if (!response.raw.body) return '';
  const reader = response.raw.body.getReader();
  const decoder = new TextDecoder();
  const read = async () => {
    let text = '';
    let bytes = 0;
    while (bytes < MAX_RESPONSE_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        return text;
      }
      const remaining = MAX_RESPONSE_BODY_BYTES - bytes;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      text += decoder.decode(chunk, { stream: true });
      bytes += chunk.byteLength;
      if (value.byteLength > remaining || bytes >= MAX_RESPONSE_BODY_BYTES) {
        await reader.cancel();
        text += decoder.decode();
        return text;
      }
    }
    return text;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch((err) => logger.warn('[app-webhook] response body cancel failed', err));
      reject(new Error(`Webhook 响应体读取超时（${TIMEOUT_MS}ms）`));
    }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([read(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    if (!timedOut) reader.releaseLock();
  }
}

async function handleTerminalFailure(
  sub: AppWebhookSubscriptionRow,
  delivery: AppWebhookDeliveryRow,
  errorMessage: string,
): Promise<void> {
  if (delivery.eventType === 'app.test') return;

  const [updated] = await db.update(appWebhookSubscriptions)
    .set({ consecutiveFailures: sql`${appWebhookSubscriptions.consecutiveFailures} + 1` })
    .where(and(
      eq(appWebhookSubscriptions.id, sub.id),
      exactTenantCondition(appWebhookSubscriptions.tenantId, delivery.tenantId ?? null),
    ))
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
      .where(and(
        eq(appWebhookSubscriptions.id, sub.id),
        exactTenantCondition(appWebhookSubscriptions.tenantId, delivery.tenantId ?? null),
      ));
  }

  if (!sub.clientId) return;
  const [owner] = await db.select({
    userId: oauth2Clients.ownerId,
    tenantId: users.tenantId,
  })
    .from(oauth2Clients)
    .leftJoin(users, eq(oauth2Clients.ownerId, users.id))
    .where(and(
      eq(oauth2Clients.clientId, sub.clientId),
      exactTenantCondition(oauth2Clients.tenantId, delivery.tenantId ?? null),
    ))
    .limit(1);
  if (!owner?.userId) return;

  const detail = autoDisabled
    ? `连续 ${updated.consecutiveFailures} 次投递失败，已自动停用。最近错误：${errorMessage}`
    : `的事件 ${delivery.eventType} 投递最终失败。错误：${errorMessage}`;
  await notify('open-platform.webhook.delivery_failed', {
    recipients: [{ type: 'user', id: owner.userId }],
    vars: { subscriptionName: sub.name, detail },
    tenantId: sub.tenantId ?? owner.tenantId ?? null,
    link: '/open-platform/my-apps',
  }).catch((err) => logger.error('[app-webhook] failure alert failed', {
    subscriptionId: sub.id,
    deliveryId: delivery.id,
    err,
  }));
}

/** attempt 为已完成的尝试次数（1-indexed）；超出重试阶梯返回 null */
export function computeNextRetryAt(attempt: number): Date | null {
  if (attempt > OPEN_WEBHOOK_RETRY_STAGES_MINUTES.length) return null;
  return new Date(Date.now() + OPEN_WEBHOOK_RETRY_STAGES_MINUTES[attempt - 1] * 60_000);
}

/**
 * 判定投递失败是否为「永久性错误」——重试永远不会成功的那一类。
 *
 * SSRF 拦截、URL 协议非法、DNS 无法解析、证书不可信都属于配置问题而非瞬时故障：
 * 继续按阶梯重试只会白白占用投递队列，并把真正需要重试的瞬时故障挤在后面。
 * 这类失败直接置为 failed，由订阅方修正回调地址后重新触发。
 */
const PERMANENT_FAILURE_PATTERNS = [
  '出站地址不允许访问本机或内网主机',
  '出站地址解析到本机、私网或保留地址',
  '出站地址 DNS 解析失败',
  '出站地址缺少主机名',
  '出站 URL 格式无效',
  '出站 URL 仅支持 HTTP/HTTPS',
  '出站 URL 禁止携带用户名或密码',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ENOTFOUND',
];

export function isPermanentDeliveryFailure(message: string): boolean {
  return PERMANENT_FAILURE_PATTERNS.some((pattern) => message.includes(pattern));
}

/** HTTP 4xx（除 408 超时与 429 限流）表示对端明确拒绝，重试无意义 */
function isPermanentResponseStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

async function claimDelivery(deliveryId: number, expectedTenantId: number | null): Promise<AppWebhookDeliveryRow | null> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - PENDING_RECOVERY_AFTER_MS);
  const [delivery] = await db.update(appWebhookDeliveries).set({
    attempt: sql`${appWebhookDeliveries.attempt} + 1`,
    status: 'pending',
    startedAt: now,
    nextRetryAt: null,
    finishedAt: null,
  }).where(and(
    eq(appWebhookDeliveries.id, deliveryId),
    exactTenantCondition(appWebhookDeliveries.tenantId, expectedTenantId),
    or(
      eq(appWebhookDeliveries.status, 'failed'),
      and(
        eq(appWebhookDeliveries.status, 'retrying'),
        lte(appWebhookDeliveries.nextRetryAt, now),
      ),
      and(
        eq(appWebhookDeliveries.status, 'pending'),
        or(
          isNull(appWebhookDeliveries.startedAt),
          lte(appWebhookDeliveries.startedAt, staleCutoff),
        ),
      ),
    ),
  )).returning();
  return delivery ?? null;
}

export async function dispatchDelivery(deliveryId: number, expectedTenantId: number | null): Promise<boolean> {
  const delivery = await claimDelivery(deliveryId, expectedTenantId);
  if (!delivery) return false;
  const tenantId = delivery.tenantId ?? null;
  const [sub] = await db
    .select()
    .from(appWebhookSubscriptions)
    .where(and(
      eq(appWebhookSubscriptions.id, delivery.subscriptionId),
      exactTenantCondition(appWebhookSubscriptions.tenantId, tenantId),
    ))
    .limit(1);
  if (!sub || sub.status !== 'enabled') {
    await updateDeliveryAfterAttempt(
      deliveryId,
      { status: 'failed', errorMessage: '订阅已被删除或禁用', finishedAt: new Date() },
      delivery.attempt,
      tenantId,
    );
    return true;
  }

  if (!sub.internal) {
    if (!sub.clientId || sub.clientId !== delivery.clientId) {
      await updateDeliveryAfterAttempt(deliveryId, {
        status: 'failed', errorMessage: '订阅与投递的应用身份不一致', finishedAt: new Date(),
      }, delivery.attempt, tenantId);
      return true;
    }
    const [client] = await db
      .select({ id: oauth2Clients.id })
      .from(oauth2Clients)
      .where(and(eq(oauth2Clients.clientId, sub.clientId), clientTenantScope(tenantId)))
      .limit(1);
    if (!client) {
      await updateDeliveryAfterAttempt(deliveryId, {
        status: 'failed', errorMessage: '订阅所属应用不存在或租户不一致', finishedAt: new Date(),
      }, delivery.attempt, tenantId);
      return true;
    }
  }

  try {
    const decryptedSecret = sub.secretEncrypted ? decryptField(sub.secretEncrypted) : null;
    assertSubscriptionPolicy({
      events: sub.events ?? [],
      signMode: sub.signMode,
      hasSecret: Boolean(decryptedSecret),
      headers: sub.headers,
    });
    if (isSensitiveWebhookEvent(delivery.eventType) && !(sub.events ?? []).includes(delivery.eventType)) {
      throw new HTTPException(400, { message: '支付与退款事件必须显式订阅' });
    }
  } catch (err) {
    await updateDeliveryAfterAttempt(deliveryId, {
      status: 'failed',
      errorMessage: (err instanceof Error ? err.message : 'Webhook 安全策略校验失败').slice(0, 1024),
      finishedAt: new Date(),
    }, delivery.attempt, tenantId);
    return true;
  }

  const attempt = delivery.attempt;
  const bodyStr = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = {
    ...(sub.headers ?? {}),
    'Content-Type': 'application/json',
    'X-Zenith-Event': delivery.eventType,
    'X-Zenith-Event-Id': delivery.eventId,
    'X-Zenith-Delivery-Id': String(delivery.id),
    'X-Zenith-Attempt': String(attempt),
  };
  if (sub.signMode === 'hmacSha256') {
    const secret = sub.secretEncrypted ? decryptField(sub.secretEncrypted) : null;
    if (secret) headers[OPEN_WEBHOOK_SIGNATURE_HEADER] = `t=${timestamp},v1=${sign(secret, timestamp, bodyStr)}`;
  }

  if (!await updateDeliveryAfterAttempt(deliveryId, { requestUrl: sub.url }, attempt, tenantId)) return false;

  const t0 = Date.now();
  try {
    const resp = await httpPost(sub.url, bodyStr, {
      headers,
      timeout: TIMEOUT_MS,
      ssrfProtection: true,
      ssrfAllowlist: config.openPlatform.webhookAllowedHosts,
      httpLog: { level: 'off' },
    });
    const durationMs = Date.now() - t0;
    const respText = await readResponseTextWithTimeout(resp);
    if (resp.ok) {
      const updated = await updateDeliveryAfterAttempt(deliveryId, {
        status: 'success',
        responseStatus: resp.status,
        responseBody: respText.slice(0, 4096),
        durationMs,
        finishedAt: new Date(),
        errorMessage: null,
        nextRetryAt: null,
      }, attempt, tenantId);
      if (!updated) return false;
      await db.update(appWebhookSubscriptions)
        .set({ consecutiveFailures: 0, lastDeliveryAt: new Date() })
        .where(and(eq(appWebhookSubscriptions.id, sub.id), exactTenantCondition(appWebhookSubscriptions.tenantId, tenantId)));
      return true;
    }
    const permanent = isPermanentResponseStatus(resp.status);
    const nextRetryAt = permanent ? null : computeNextRetryAt(attempt);
    const updated = await updateDeliveryAfterAttempt(deliveryId, {
      status: nextRetryAt ? 'retrying' : 'failed',
      responseStatus: resp.status,
      responseBody: respText.slice(0, 4096),
      durationMs,
      errorMessage: permanent ? `HTTP ${resp.status}（对端拒绝，不再重试）` : `HTTP ${resp.status}`,
      nextRetryAt,
      finishedAt: nextRetryAt ? null : new Date(),
    }, attempt, tenantId);
    if (!updated) return false;
    await db.update(appWebhookSubscriptions).set({ lastDeliveryAt: new Date() }).where(and(
      eq(appWebhookSubscriptions.id, sub.id),
      exactTenantCondition(appWebhookSubscriptions.tenantId, tenantId),
    ));
    if (!nextRetryAt) await handleTerminalFailure(sub, delivery, `HTTP ${resp.status}`);
  } catch (err) {
    const durationMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    const permanent = isPermanentDeliveryFailure(msg);
    const nextRetryAt = permanent ? null : computeNextRetryAt(attempt);
    const errorMessage = permanent ? `${msg}（配置错误，不再重试）` : msg;
    const updated = await updateDeliveryAfterAttempt(deliveryId, {
      status: nextRetryAt ? 'retrying' : 'failed',
      errorMessage: errorMessage.slice(0, 1024),
      durationMs,
      nextRetryAt,
      finishedAt: nextRetryAt ? null : new Date(),
    }, attempt, tenantId);
    if (!updated) return false;
    if (!nextRetryAt) await handleTerminalFailure(sub, delivery, errorMessage.slice(0, 1024));
  }
  return true;
}

/**
 * 事件 → 订阅匹配。
 *
 * 应用域事件（带 clientId）定向投递给该应用；站点域事件（cms.*，无 clientId）
 * 广播给「已被授权该站点」的应用 —— 授权表是唯一的可见性来源，未授权应用即便
 * 订阅了事件类型也收不到，避免通过 Webhook 侧信道泄露其他站点的内容变更。
 * 平台域事件（iot.* 等，无 clientId 无站点范围）仅投递给**显式**订阅了该事件
 * 类型、且未绑定 CMS 站点的订阅 —— 不含空列表通配，避免站点通配订阅被平台事件打扰。
 */
async function findMatchingSubscriptions(event: OpenPlatformEvent): Promise<AppWebhookSubscriptionRow[]> {
  const siteId = event.scope?.siteId;
  if (event.clientId) {
    const [client] = await db
      .select({ tenantId: oauth2Clients.tenantId })
      .from(oauth2Clients)
      .where(eq(oauth2Clients.clientId, event.clientId))
      .limit(1);
    if (!client) return [];
    if (event.tenantId !== undefined && (client.tenantId ?? null) !== event.tenantId) return [];
    const rows = await db.select().from(appWebhookSubscriptions)
      .where(and(
        eq(appWebhookSubscriptions.clientId, event.clientId),
        exactTenantCondition(appWebhookSubscriptions.tenantId, client.tenantId ?? null),
        eq(appWebhookSubscriptions.internal, false),
        eq(appWebhookSubscriptions.status, 'enabled'),
      ));
    return rows.filter((s) => matchesEventType(s, event.type) && matchesSite(s, siteId));
  }
  if (siteId == null) {
    const rows = await db.select().from(appWebhookSubscriptions)
      .where(eq(appWebhookSubscriptions.status, 'enabled'));
    const validRows = await filterClientTenantScopes(rows);
    // 无 clientId 的平台事件必须携带租户；缺失租户时只允许平台级订阅，
    // 绝不把设备/告警/支付数据广播给任意租户。
    const platformMatches = validRows.filter((s) => (s.tenantId ?? null) === (event.tenantId ?? null)
      && matchesEventType(s, event.type)
      && (s.events ?? []).includes(event.type)
      && s.cmsSiteId == null);
    // 网盘空间域事件：外部应用还必须被治理侧显式授权该空间，未授权空间的文件变更对应用不可见
    const spaceId = event.scope?.spaceId;
    if (spaceId == null || platformMatches.length === 0) return platformMatches;
    const { clientIdsGrantedForSpace } = await import('../drive/drive-open.service');
    const granted = await clientIdsGrantedForSpace(spaceId, platformMatches.map((s) => s.clientId).filter((id): id is string => id != null));
    return platformMatches.filter((s) => s.clientId != null && granted.has(s.clientId));
  }

  const rows = await db.select().from(appWebhookSubscriptions)
    .where(eq(appWebhookSubscriptions.status, 'enabled'));
  const validRows = await filterClientTenantScopes(rows);
  const candidates = validRows.filter((s) => matchesEventType(s, event.type) && matchesSite(s, siteId));
  if (candidates.length === 0) return [];

  // 内部订阅由站点 Webhook 配置托管，不需要开放应用授权；外部应用必须显式授权该站点
  const externalClientIds = [...new Set(candidates
    .filter((s): s is AppWebhookSubscriptionRow & { clientId: string } => !s.internal && s.clientId != null)
    .map((s) => s.clientId))];
  const granted = externalClientIds.length > 0
    ? new Set((await db.select({ clientId: cmsOpenAppGrants.clientId }).from(cmsOpenAppGrants).where(and(
        eq(cmsOpenAppGrants.siteId, siteId),
        eq(cmsOpenAppGrants.status, 'enabled'),
        inArray(cmsOpenAppGrants.clientId, externalClientIds),
      ))).map((row) => row.clientId))
    : new Set<string>();
  return candidates.filter((s) => s.internal || (s.clientId != null && granted.has(s.clientId)));
}

function matchesEventType(sub: AppWebhookSubscriptionRow, type: string): boolean {
  const events = sub.events ?? [];
  if (isSensitiveWebhookEvent(type)) {
    return events.includes(type) && sub.signMode === 'hmacSha256' && Boolean(sub.secretEncrypted);
  }
  return events.length === 0 || events.includes(type);
}

async function filterClientTenantScopes(rows: AppWebhookSubscriptionRow[]): Promise<AppWebhookSubscriptionRow[]> {
  const clientIds = [...new Set(rows
    .filter((row): row is AppWebhookSubscriptionRow & { clientId: string } => !row.internal && row.clientId != null)
    .map((row) => row.clientId))];
  const clients = clientIds.length > 0
    ? await db
      .select({ clientId: oauth2Clients.clientId, tenantId: oauth2Clients.tenantId })
      .from(oauth2Clients)
      .where(inArray(oauth2Clients.clientId, clientIds))
    : [];
  const tenantByClientId = new Map(clients.map((client) => [client.clientId, client.tenantId ?? null]));
  return rows.filter((row) => {
    if (row.internal) return row.clientId == null;
    return row.clientId != null
      && tenantByClientId.has(row.clientId)
      && tenantByClientId.get(row.clientId) === (row.tenantId ?? null);
  });
}

function matchesSite(sub: AppWebhookSubscriptionRow, siteId: number | undefined): boolean {
  if (sub.cmsSiteId == null) return true;
  return sub.cmsSiteId === siteId;
}

/** 注册开放平台事件总线订阅者：事件 → 匹配订阅 → 投递 */
export function registerOpenWebhookSubscriber(): void {
  openEventBus.onAny(async (event) => {
    try {
      const subs = await findMatchingSubscriptions(event);
      // tenantId 仅用于服务端路由与持久化隔离，不作为内部租户标识暴露给第三方应用。
      const { tenantId: _tenantId, ...publicEvent } = event;
      for (const sub of subs) {
        const delivery = await insertDelivery({
          subscriptionId: sub.id,
          clientId: sub.clientId,
          tenantId: sub.tenantId ?? null,
          eventType: event.type,
          eventId: event.eventId,
          payload: publicEvent,
        });
        if (!delivery) continue;
        queueMicrotask(() => {
          dispatchDelivery(delivery.id, sub.tenantId ?? null).catch((err) => logger.error('[app-webhook] dispatch failed', { deliveryId: delivery.id, err }));
        });
      }
    } catch (err) {
      logger.error('[app-webhook] subscriber error', { eventId: event.eventId, err });
      throw err;
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
  const results = await mapWithConcurrency(rows, RETRY_CONCURRENCY, async (row) => dispatchDelivery(row.id, row.tenantId ?? null));
  return { retried: results.filter(Boolean).length };
}
