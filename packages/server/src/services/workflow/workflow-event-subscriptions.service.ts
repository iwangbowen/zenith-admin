import { workflowEventSubscriptionContract } from '@zenith/shared/workflow';
import type { QueryOutputOf } from '@zenith/shared/core';
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
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
import { inheritedTenantCondition, tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { buildWhere, dateRangeConditions, keywordCondition, nullableEq } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime, formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { decryptSecret, encryptSecret } from '../../lib/secret-crypto';
import { assertSafeWorkflowUrl, workflowHttpPost } from '../../lib/workflow-outbound';
import { payloadRecord, payloadString } from './payload-utils';
import { countJobExecutions, jobExecutionsWithJob } from './workflow-job-execution-helpers';
import { signHmac } from '../../lib/workflow-jobs/handlers/shared';
import { enqueueJob, retryJob, scheduleJobPickup } from '../../lib/workflow-jobs/engine';
import { invokeConnector, getConnectorRowById } from './workflow-connectors.service';
import type { WorkflowEventType } from '@zenith/shared/workflow';
import { maskSecret } from '@zenith/shared/core';

/** 订阅密钥展示：保留头尾 4 位（`@zenith/shared/core` 默认口径），空值返回 null */
function maskSubscriptionSecret(secret: string | null | undefined): string | null {
  return secret ? maskSecret(secret) : null;
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
    secretMasked: maskSubscriptionSecret(decryptSubscriptionSecret(row.secretEncrypted)),
    signMode: row.signMode,
    headers: parseHeaders(row.headers),
    connectorId: row.connectorId ?? null,
    enabled: row.enabled,
    tenantId: row.tenantId,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    ...formatTimestamps(row),
  };
}

/** 按 id 定位当前租户可见的订阅 */
function findSubscription(id: number) {
  return buildWhere(eq(workflowEventSubscriptions.id, id), tenantCondition(workflowEventSubscriptions, currentUser()));
}

export async function ensureSubscriptionExists(id: number) {
  return requireFirstRow(db.select().from(workflowEventSubscriptions).where(findSubscription(id)).limit(1), '事件订阅不存在');
}

export async function listSubscriptions(q: QueryOutputOf<typeof workflowEventSubscriptionContract.list>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    tenantCondition(workflowEventSubscriptions, currentUser()),
    keywordCondition(q.keyword, [workflowEventSubscriptions.name, workflowEventSubscriptions.url], 'ilike'),
    q.definitionId !== undefined ? nullableEq(workflowEventSubscriptions.definitionId, q.definitionId) : undefined,
    q.enabled !== undefined ? eq(workflowEventSubscriptions.enabled, q.enabled) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(workflowEventSubscriptions, where),
    rows: () => db.select({
      sub: workflowEventSubscriptions,
      definitionName: workflowDefinitions.name,
    }).from(workflowEventSubscriptions)
      .leftJoin(workflowDefinitions, eq(workflowEventSubscriptions.definitionId, workflowDefinitions.id))
      .where(where)
      .orderBy(desc(workflowEventSubscriptions.id))
      .limit(pageSize).offset(pageOffset(page, pageSize)),
    map: (r) => mapSubscription(r.sub, r.definitionName),
  });
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
    const [row] = await db.update(workflowEventSubscriptions).set(patch).where(findSubscription(id)).returning();
    return mapSubscription(requireRow(row, '事件订阅不存在'));
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    rethrowPgUniqueViolation(err, '订阅名称已存在');
  }
}

export async function deleteSubscription(id: number) {
  await ensureSubscriptionExists(id);
  await db.delete(workflowEventSubscriptions).where(findSubscription(id));
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
  const tenantCond = inheritedTenantCondition(workflowEventSubscriptions.tenantId, tenantId);
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

const DELIVERY_SELECTION = {
  execution: workflowJobExecutions,
  job: workflowJobs,
  subscriptionName: workflowEventSubscriptions.name,
} as const;

/** 投递记录查询：执行记录 ⋈ 父作业，并按 payload.subscriptionId 关联订阅名 */
function deliveriesQuery() {
  return jobExecutionsWithJob(DELIVERY_SELECTION)
    .leftJoin(workflowEventSubscriptions, sql`(${workflowJobs.payload}->>'subscriptionId')::int = ${workflowEventSubscriptions.id}`);
}

/** 投递记录范围条件：webhook_delivery 类型 + 当前用户租户范围（按父作业表判定） */
function deliveryConditions(...extra: (SQL | undefined)[]): SQL | undefined {
  return buildWhere(
    eq(workflowJobExecutions.jobType, 'webhook_delivery'),
    tenantCondition(workflowJobs, currentUser()),
    ...extra,
  );
}

/** 按投递记录 id 定位父作业 id（重试入口用） */
function findDeliveryJobIds(idCondition: SQL): Promise<{ jobId: number }[]> {
  return jobExecutionsWithJob({ jobId: workflowJobs.id }).where(deliveryConditions(idCondition));
}

export async function listDeliveries(q: QueryOutputOf<typeof workflowEventSubscriptionContract.deliveries>) {
  const { page, pageSize } = q;
  const statusCondition = (): SQL | undefined => {
    switch (q.status) {
      case 'success': return eq(workflowJobExecutions.status, 'succeeded');
      case 'failed': return or(eq(workflowJobExecutions.status, 'failed'), eq(workflowJobs.status, 'dead'));
      case 'retrying': return and(eq(workflowJobExecutions.status, 'failed'), sql`${workflowJobs.attempts} < ${workflowJobs.maxAttempts}`);
      case 'pending': return inArray(workflowJobs.status, ['pending', 'running']);
      default: return undefined;
    }
  };
  const where = deliveryConditions(
    q.subscriptionId ? sql`(${workflowJobs.payload}->>'subscriptionId')::int = ${q.subscriptionId}` : undefined,
    q.instanceId ? eq(workflowJobs.instanceId, q.instanceId) : undefined,
    statusCondition(),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => countJobExecutions(where),
    rows: () => deliveriesQuery()
      .where(where).orderBy(desc(workflowJobExecutions.id))
      .limit(pageSize).offset(pageOffset(page, pageSize)),
    map: (r) => mapDelivery(r, r.subscriptionName),
  });
}

export async function getDelivery(id: number) {
  const [row] = await deliveriesQuery()
    .where(deliveryConditions(eq(workflowJobExecutions.id, id)))
    .limit(1);
  return mapDelivery(requireRow(row, '投递记录不存在'));
}

export async function getDeliveryBeforeAudit(id: number) {
  return getDelivery(id).catch((err) => {
    if (err instanceof HTTPException && err.status === 404) return null;
    throw err;
  });
}

export async function getDeliveriesBeforeAudit(ids: number[]) {
  if (!ids.length) return [];
  const rows = await deliveriesQuery()
    .where(deliveryConditions(inArray(workflowJobExecutions.id, ids)))
    .orderBy(desc(workflowJobExecutions.id));
  return rows.map((r) => mapDelivery(r, r.subscriptionName));
}

/** 手动重置投递为 retrying 立即重试 */
export async function retryDelivery(id: number) {
  const [row] = await findDeliveryJobIds(eq(workflowJobExecutions.id, id));
  requireRow(row, '投递记录不存在');
  if (!await retryJob(row.jobId)) throw new HTTPException(409, { message: '仅失败或已取消的投递可以重试' });
  return getDelivery(id);
}

/** 批量重试（按 ids） */
export async function retryDeliveries(ids: number[]) {
  if (ids.length === 0) return 0;
  const rows = await findDeliveryJobIds(inArray(workflowJobExecutions.id, ids));
  if (rows.length === 0) return 0;
  let retried = 0;
  for (const jobId of new Set(rows.map((row) => row.jobId))) if (await retryJob(jobId)) retried++;
  return retried;
}

/** 按筛选批量重放投递的最大条数（防止误操作一次重投海量历史投递） */
const DELIVERY_REPLAY_CAP = 500;

export interface ReplayDeliveriesFilter {
  subscriptionId?: number;
  eventType?: string;
  /** success=补发已成功；failed=重投失败/死信；pending=补投待执行；all/不传=全部状态 */
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
  const statusCondition = (): SQL | undefined => {
    switch (f.status) {
      case 'success': return eq(workflowJobs.status, 'succeeded');
      case 'failed': return inArray(workflowJobs.status, ['failed', 'dead']);
      case 'pending': return eq(workflowJobs.status, 'pending');
      default: return undefined;
    }
  };
  const targets = await db.select().from(workflowJobs)
    .where(buildWhere(
      eq(workflowJobs.jobType, 'webhook_delivery'),
      tenantCondition(workflowJobs, currentUser()),
      f.subscriptionId ? sql`(${workflowJobs.payload}->>'subscriptionId')::int = ${f.subscriptionId}` : undefined,
      f.eventType ? sql`${workflowJobs.payload}->>'eventType' = ${f.eventType}` : undefined,
      statusCondition(),
      ...dateRangeConditions(workflowJobs.createdAt, f.startAt, f.endAt),
    ))
    .orderBy(desc(workflowJobs.id))
    .limit(DELIVERY_REPLAY_CAP);
  if (targets.length === 0) return { count: 0 };
  let count = 0;
  for (const job of targets) {
    if (job.status === 'pending') {
      scheduleJobPickup(job.id, job.runAt);
      count++;
    } else if (job.status === 'failed' || job.status === 'dead' || job.status === 'canceled') {
      if (await retryJob(job.id)) count++;
    } else if (job.status === 'succeeded') {
      const replay = await enqueueJob({
        jobType: job.jobType,
        payload: (job.payload ?? {}) as Record<string, unknown>,
        instanceId: job.instanceId,
        taskId: job.taskId,
        nodeKey: job.nodeKey,
        idempotencyKey: `replay:${job.id}:${randomUUID()}`,
        traceId: job.traceId,
        priority: job.priority,
        maxAttempts: job.maxAttempts,
        executionTimeoutMs: job.executionTimeoutMs,
        tenantId: job.tenantId,
      });
      if (replay) count++;
    }
  }
  return { count };
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
