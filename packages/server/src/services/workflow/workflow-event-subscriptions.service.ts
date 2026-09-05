import { and, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../../db';
import {
  workflowEventSubscriptions,
  workflowDefinitions,
  workflowJobExecutions,
  workflowJobs,
} from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime, formatNullableDateTime, parseDateRangeStart, parseDateRangeEnd } from '../../lib/datetime';
import { decryptSecret, encryptSecret } from '../../lib/secret-crypto';
import { assertSafeWorkflowUrl, workflowHttpPost } from '../../lib/workflow-outbound';
import { signHmac } from '../../lib/workflow-jobs/handlers/shared';
import { invokeConnector, getConnectorRowById } from './workflow-connectors.service';
import type { WorkflowEventType } from '@zenith/shared/workflow';

function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

/** 解密订阅密钥（AES-256-GCM 存储；解密失败按无密钥处理并保底不抛错） */
export function decryptSubscriptionSecret(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  try {
    return decryptSecret(encrypted);
  } catch {
    return null;
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
    events: (Array.isArray(row.events) ? row.events : []) as WorkflowEventType[],
    url: row.url,
    secretMasked: maskSecret(decryptSubscriptionSecret(row.secretEncrypted)),
    signMode: row.signMode,
    headers: parseHeaders(row.headers),
    connectorId: row.connectorId ?? null,
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
  conds.push(keywordCondition(q.keyword, [workflowEventSubscriptions.name, workflowEventSubscriptions.url], 'ilike'));
  if (q.definitionId !== undefined) {
    conds.push(q.definitionId === null ? isNull(workflowEventSubscriptions.definitionId) : eq(workflowEventSubscriptions.definitionId, q.definitionId));
  }
  if (q.enabled !== undefined) conds.push(eq(workflowEventSubscriptions.enabled, q.enabled));
  const where = buildWhere(...conds);
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
  return { id: row.id, secret: decryptSubscriptionSecret(row.secretEncrypted) };
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
  connectorId?: number | null;
  enabled?: boolean;
}

export async function createSubscription(input: UpsertSubscriptionInput) {
  if (input.events.length === 0) throw new HTTPException(400, { message: '至少订阅一个事件类型' });
  // 直连 URL 保存时即校验；走连接器时 url 只是相对路径（同源约束由 buildConnectorUrl 保证）
  if (!input.connectorId && input.url) await assertSafeWorkflowUrl(input.url);
  try {
    const user = currentUser();
    const [row] = await db.insert(workflowEventSubscriptions).values({
      name: input.name,
      description: input.description ?? null,
      definitionId: input.definitionId ?? null,
      events: input.events,
      url: input.url,
      secretEncrypted: input.secret ? encryptSecret(input.secret) : null,
      signMode: input.signMode ?? 'hmacSha256',
      headers: input.headers ? JSON.stringify(input.headers) : null,
      connectorId: input.connectorId ?? null,
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
  const existing = await ensureSubscriptionExists(id);
  const nextConnectorId = input.connectorId !== undefined ? input.connectorId : existing.connectorId;
  const nextUrl = input.url !== undefined ? input.url : existing.url;
  if ((input.url !== undefined || input.connectorId !== undefined) && !nextConnectorId && nextUrl) {
    await assertSafeWorkflowUrl(nextUrl);
  }
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
    patch.events = input.events;
  }
  if (input.url !== undefined) patch.url = input.url;
  if (input.secret !== undefined) patch.secretEncrypted = input.secret ? encryptSecret(input.secret) : null;
  if (input.signMode !== undefined) patch.signMode = input.signMode;
  if (input.headers !== undefined) patch.headers = input.headers ? JSON.stringify(input.headers) : null;
  if (input.connectorId !== undefined) patch.connectorId = input.connectorId;
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
  return rows.filter((r) => (Array.isArray(r.events) ? r.events : []).includes(eventType));
}

// ─── 投递记录 ──────────────────────────────────────────────────────────────

type WebhookDeliveryStatus = 'pending' | 'success' | 'failed' | 'retrying';

type WebhookDeliveryRow = {
  execution: typeof workflowJobExecutions.$inferSelect;
  job: typeof workflowJobs.$inferSelect;
  subscriptionName?: string | null;
};

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

function payloadString(payload: unknown, key: string): string | null {
  const value = payloadRecord(payload)[key];
  return typeof value === 'string' ? value : null;
}

function payloadNumber(payload: unknown, key: string): number | null {
  const value = payloadRecord(payload)[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function payloadWorkflowEvent(payload: unknown) {
  const value = payloadRecord(payload).payload ?? payloadRecord(payload).event ?? null;
  return value ?? null;
}

function mapDeliveryStatus(row: WebhookDeliveryRow): WebhookDeliveryStatus {
  if (row.execution.status === 'succeeded' || row.job.status === 'succeeded') return 'success';
  if (row.job.status === 'failed' && row.job.attempts < row.job.maxAttempts) return 'retrying';
  if (row.execution.status === 'failed' || row.job.status === 'failed' || row.job.status === 'dead') return 'failed';
  return 'pending';
}

export function mapDelivery(row: WebhookDeliveryRow, subscriptionName?: string | null) {
  // webhook_delivery 作业 payload 形如 { subscriptionId, event }，事件类型/ID 取自嵌套 event
  const event = payloadRecord(payloadRecord(row.job.payload).event);
  return {
    id: row.execution.id,
    subscriptionId: payloadNumber(row.job.payload, 'subscriptionId') ?? 0,
    subscriptionName: subscriptionName ?? row.subscriptionName ?? null,
    instanceId: row.job.instanceId ?? null,
    taskId: row.job.taskId ?? null,
    eventId: (typeof event.eventId === 'string' ? event.eventId : null) ?? payloadString(row.job.payload, 'eventId') ?? row.job.idempotencyKey ?? String(row.job.id),
    eventType: (typeof event.type === 'string' ? event.type : null) ?? payloadString(row.job.payload, 'eventType') ?? 'workflow.event',
    payload: payloadWorkflowEvent(row.job.payload),
    attempt: row.execution.attempt,
    status: mapDeliveryStatus(row),
    requestUrl: row.execution.requestUrl,
    requestHeaders: null,
    responseStatus: row.execution.responseStatus,
    responseBody: row.execution.responseBody,
    errorMessage: row.execution.errorMessage ?? row.job.lastError,
    durationMs: row.execution.durationMs,
    nextRetryAt: row.job.status === 'failed' ? formatNullableDateTime(row.job.runAt) : null,
    startedAt: formatNullableDateTime(row.execution.startedAt),
    finishedAt: formatNullableDateTime(row.execution.finishedAt),
    tenantId: row.execution.tenantId ?? row.job.tenantId,
    createdAt: formatDateTime(row.execution.createdAt),
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
  const tc = tenantCondition(workflowJobs, currentUser());
  const conds: (SQL | undefined)[] = [eq(workflowJobExecutions.jobType, 'webhook_delivery')];
  if (tc) conds.push(tc);
  if (q.subscriptionId) conds.push(sql`(${workflowJobs.payload}->>'subscriptionId')::int = ${q.subscriptionId}`);
  if (q.instanceId) conds.push(eq(workflowJobs.instanceId, q.instanceId));
  if (q.status === 'success') conds.push(eq(workflowJobExecutions.status, 'succeeded'));
  else if (q.status === 'failed') conds.push(or(eq(workflowJobExecutions.status, 'failed'), eq(workflowJobs.status, 'dead'))!);
  else if (q.status === 'retrying') conds.push(and(eq(workflowJobExecutions.status, 'failed'), sql`${workflowJobs.attempts} < ${workflowJobs.maxAttempts}`)!);
  else if (q.status === 'pending') conds.push(inArray(workflowJobs.status, ['pending', 'running']));
  const where = and(...conds);
  const [total, rows] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` })
      .from(workflowJobExecutions)
      .innerJoin(workflowJobs, eq(workflowJobExecutions.jobId, workflowJobs.id))
      .where(where)
      .then((r) => r[0]?.c ?? 0),
    db.select({ execution: workflowJobExecutions, job: workflowJobs, subscriptionName: workflowEventSubscriptions.name })
      .from(workflowJobExecutions)
      .innerJoin(workflowJobs, eq(workflowJobExecutions.jobId, workflowJobs.id))
      .leftJoin(workflowEventSubscriptions, sql`(${workflowJobs.payload}->>'subscriptionId')::int = ${workflowEventSubscriptions.id}`)
      .where(where).orderBy(desc(workflowJobExecutions.id))
      .limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map((r) => mapDelivery(r, r.subscriptionName)), total, page, pageSize };
}

export async function getDelivery(id: number) {
  const tc = tenantCondition(workflowJobs, currentUser());
  const conds: (SQL | undefined)[] = [eq(workflowJobExecutions.id, id), eq(workflowJobExecutions.jobType, 'webhook_delivery')];
  if (tc) conds.push(tc);
  const [row] = await db.select({ execution: workflowJobExecutions, job: workflowJobs, subscriptionName: workflowEventSubscriptions.name })
    .from(workflowJobExecutions)
    .innerJoin(workflowJobs, eq(workflowJobExecutions.jobId, workflowJobs.id))
    .leftJoin(workflowEventSubscriptions, sql`(${workflowJobs.payload}->>'subscriptionId')::int = ${workflowEventSubscriptions.id}`)
    .where(and(...conds))
    .limit(1);
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
  const tc = tenantCondition(workflowJobs, currentUser());
  const conds: (SQL | undefined)[] = [inArray(workflowJobExecutions.id, ids), eq(workflowJobExecutions.jobType, 'webhook_delivery')];
  if (tc) conds.push(tc);
  const rows = await db.select({ execution: workflowJobExecutions, job: workflowJobs, subscriptionName: workflowEventSubscriptions.name })
    .from(workflowJobExecutions)
    .innerJoin(workflowJobs, eq(workflowJobExecutions.jobId, workflowJobs.id))
    .leftJoin(workflowEventSubscriptions, sql`(${workflowJobs.payload}->>'subscriptionId')::int = ${workflowEventSubscriptions.id}`)
    .where(and(...conds))
    .orderBy(desc(workflowJobExecutions.id));
  return rows.map((r) => mapDelivery(r, r.subscriptionName));
}

/** 候选重试任务：状态 retrying 且 nextRetryAt 已到 */
export async function findRetryableDeliveries(limit = 50) {
  const rows = await db.select().from(workflowJobs)
    .where(and(
      eq(workflowJobs.jobType, 'webhook_delivery'),
      eq(workflowJobs.status, 'failed'),
      sql`${workflowJobs.attempts} < ${workflowJobs.maxAttempts}`,
      sql`${workflowJobs.runAt} <= now()`,
    ))
    .limit(limit);
  return rows;
}

export async function findDeliveryById(id: number) {
  const [row] = await db.select({ execution: workflowJobExecutions, job: workflowJobs })
    .from(workflowJobExecutions)
    .innerJoin(workflowJobs, eq(workflowJobExecutions.jobId, workflowJobs.id))
    .where(eq(workflowJobExecutions.id, id))
    .limit(1);
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
  const [row] = await db.insert(workflowJobs).values({
    jobType: 'webhook_delivery',
    status: 'pending',
    instanceId: input.instanceId,
    taskId: input.taskId,
    idempotencyKey: `webhook:${input.subscriptionId}:${input.eventId}`,
    payload: {
      subscriptionId: input.subscriptionId,
      eventId: input.eventId,
      eventType: input.eventType,
      payload: input.payload,
    },
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

export async function updateDeliveryAfterAttempt(id: number, patch: Record<string, unknown>) {
  const status = patch.status === 'success'
    ? 'succeeded'
    : patch.status === 'failed'
      ? 'dead'
      : patch.status === 'retrying'
        ? 'failed'
        : undefined;
  if (status) {
    await db.update(workflowJobs).set({
      status,
      lastError: typeof patch.errorMessage === 'string' ? patch.errorMessage : undefined,
      runAt: patch.nextRetryAt instanceof Date ? patch.nextRetryAt : undefined,
    }).where(eq(workflowJobs.id, id));
  }
}

/** 手动重置投递为 retrying 立即重试 */
export async function retryDelivery(id: number) {
  const tc = tenantCondition(workflowJobs, currentUser());
  const conds: (SQL | undefined)[] = [eq(workflowJobExecutions.id, id), eq(workflowJobExecutions.jobType, 'webhook_delivery')];
  if (tc) conds.push(tc);
  const [row] = await db.select({ jobId: workflowJobs.id })
    .from(workflowJobExecutions)
    .innerJoin(workflowJobs, eq(workflowJobExecutions.jobId, workflowJobs.id))
    .where(and(...conds))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '投递记录不存在' });
  await db.update(workflowJobs).set({ status: 'pending', runAt: new Date(), lastError: null }).where(eq(workflowJobs.id, row.jobId));
  return getDelivery(id);
}

/** 批量重试（按 ids） */
export async function retryDeliveries(ids: number[]) {
  if (ids.length === 0) return 0;
  const tc = tenantCondition(workflowJobs, currentUser());
  const conds: (SQL | undefined)[] = [inArray(workflowJobExecutions.id, ids), eq(workflowJobExecutions.jobType, 'webhook_delivery')];
  if (tc) conds.push(tc);
  const rows = await db.select({ jobId: workflowJobs.id })
    .from(workflowJobExecutions)
    .innerJoin(workflowJobs, eq(workflowJobExecutions.jobId, workflowJobs.id))
    .where(and(...conds));
  if (rows.length === 0) return 0;
  await db.update(workflowJobs)
    .set({ status: 'pending', runAt: new Date(), lastError: null })
    .where(inArray(workflowJobs.id, rows.map((row) => row.jobId)));
  return rows.length;
}

/** 按筛选批量重放投递的最大条数（防止误操作一次重投海量历史投递） */
const DELIVERY_REPLAY_CAP = 500;

export interface ReplayDeliveriesFilter {
  subscriptionId?: number;
  eventType?: string;
  /** success=补发已成功；failed=重投失败/死信；pending=重排队中；all/不传=全部状态 */
  status?: 'success' | 'failed' | 'pending' | 'all';
  /** 起止时间（按作业创建时间，YYYY-MM-DD HH:mm:ss） */
  startAt?: string;
  endAt?: string;
}

/**
 * 按筛选条件批量重放事件投递：把匹配的 webhook_delivery 作业重置为 pending 立即重投。
 * 与「按 ids 重试」互补——支持订阅 + 事件类型 + 时间范围 + 状态维度，含**补发已成功**投递。
 * 上限 DELIVERY_REPLAY_CAP，返回实际重放条数。
 */
export async function replayDeliveriesByFilter(f: ReplayDeliveriesFilter): Promise<{ count: number }> {
  const tc = tenantCondition(workflowJobs, currentUser());
  const conds: (SQL | undefined)[] = [eq(workflowJobs.jobType, 'webhook_delivery')];
  if (tc) conds.push(tc);
  if (f.subscriptionId) conds.push(sql`(${workflowJobs.payload}->>'subscriptionId')::int = ${f.subscriptionId}`);
  if (f.eventType) conds.push(sql`${workflowJobs.payload}->>'eventType' = ${f.eventType}`);
  if (f.status === 'success') conds.push(eq(workflowJobs.status, 'succeeded'));
  else if (f.status === 'failed') conds.push(inArray(workflowJobs.status, ['failed', 'dead']));
  else if (f.status === 'pending') conds.push(inArray(workflowJobs.status, ['pending', 'running']));
  const start = parseDateRangeStart(f.startAt);
  const end = parseDateRangeEnd(f.endAt);
  if (start) conds.push(gte(workflowJobs.createdAt, start));
  if (end) conds.push(lte(workflowJobs.createdAt, end));

  const targets = await db.select({ id: workflowJobs.id })
    .from(workflowJobs)
    .where(and(...conds))
    .orderBy(desc(workflowJobs.id))
    .limit(DELIVERY_REPLAY_CAP);
  if (targets.length === 0) return { count: 0 };
  await db.update(workflowJobs)
    .set({ status: 'pending', runAt: new Date(), lastError: null })
    .where(inArray(workflowJobs.id, targets.map((t) => t.id)));
  return { count: targets.length };
}

// ─── 测试投递 ────────────────────────────────────────────────────────

export interface TestDeliveryResult {
  ok: boolean;
  httpStatus: number | null;
  durationMs: number;
  responseSnippet: string | null;
  error: string | null;
  requestUrl: string;
  eventType: string;
}

/**
 * 测试投递：向订阅地址同步发送一条带 test 标记的样例事件，立即返回 HTTP 结果。
 * - 复用真实投递的签名 / 自定义头 / 连接器链路，验证的就是线上路径；
 * - 不入作业队列、不产生投递记录，禁用中的订阅也可测试（便于上线前验证）。
 */
export async function testSubscriptionDelivery(id: number): Promise<TestDeliveryResult> {
  const row = await ensureSubscriptionExists(id);
  const eventType = (Array.isArray(row.events) && row.events.length > 0 ? row.events[0] : 'instance.approved') as string;
  const now = new Date();
  const sampleEvent = {
    eventId: randomUUID(),
    type: eventType,
    occurredAt: formatDateTime(now),
    instanceId: 0,
    definitionId: row.definitionId ?? 0,
    tenantId: null,
    test: true,
    note: '这是一条测试投递（非真实业务事件），用于验证订阅地址、签名与连接器配置',
  };
  const bodyStr = JSON.stringify(sampleEvent);
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Zenith-Event': eventType,
    'X-Zenith-Event-Id': sampleEvent.eventId,
    'X-Zenith-Test': '1',
    ...(parseHeaders(row.headers) ?? {}),
  };
  if (row.signMode === 'hmacSha256' && row.secretEncrypted) {
    const secret = decryptSubscriptionSecret(row.secretEncrypted);
    if (secret) headers['X-Zenith-Signature'] = `t=${timestamp},v1=${signHmac(secret, timestamp, bodyStr)}`;
  }

  const startedAt = Date.now();
  const base: Omit<TestDeliveryResult, 'ok' | 'httpStatus' | 'responseSnippet' | 'error'> = {
    durationMs: 0,
    requestUrl: row.url,
    eventType,
  };
  try {
    if (row.connectorId) {
      const connector = await getConnectorRowById(row.connectorId);
      if (!connector) {
        return { ...base, durationMs: Date.now() - startedAt, ok: false, httpStatus: null, responseSnippet: null, error: `投递连接器 #${row.connectorId} 不存在` };
      }
      base.requestUrl = `[connector:${connector.code}] ${row.url ?? ''}`.trim();
      const r = await invokeConnector(connector, { path: row.url || undefined, method: 'POST', headers, body: bodyStr, source: 'webhook' });
      return { ...base, durationMs: Date.now() - startedAt, ok: r.ok, httpStatus: r.status ?? null, responseSnippet: r.responseSnippet ?? null, error: r.ok ? null : (r.error ?? '连接器调用失败') };
    }
    const resp = await workflowHttpPost(row.url, bodyStr, { headers, timeout: 10_000 });
    const respText = await resp.text().catch(() => '');
    return { ...base, durationMs: Date.now() - startedAt, ok: resp.ok, httpStatus: resp.status, responseSnippet: respText.slice(0, 1024) || null, error: resp.ok ? null : `HTTP ${resp.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...base, durationMs: Date.now() - startedAt, ok: false, httpStatus: null, responseSnippet: null, error: msg.slice(0, 512) };
  }
}
