/**
 * 流程连接器服务：统一外部集成注册中心（首期 http）。
 * - CRUD + 凭据 AES 加密落库 / 脱敏返回
 * - invokeConnector：运行时调用（http-client 重试/超时 + 熔断），供未来触发器/Webhook 节点复用
 * - testConnector：一键测试探测
 */
import { and, desc, eq, gte, ilike, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { workflowConnectors, workflowConnectorInvocations } from '../db/schema';
import type { WorkflowConnectorRow } from '../db/schema';
import { currentUser } from '../lib/context';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { escapeLike } from '../lib/where-helpers';
import { pageOffset } from '../lib/pagination';
import { formatDateTime } from '../lib/datetime';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { encryptField, decryptField } from '../lib/encryption';
import { httpRequest } from '../lib/http-client';
import { breakerAllow, breakerSuccess, breakerFailure, breakerState, breakerReset } from '../lib/workflow-connector-breaker';
import type {
  WorkflowConnector, WorkflowConnectorType, WorkflowConnectorHttpConfig, WorkflowConnectorCredentials,
  WorkflowConnectorInvokeResult, CreateWorkflowConnectorInput, UpdateWorkflowConnectorInput, TestWorkflowConnectorInput,
} from '@zenith/shared';

// ─── 凭据编解码 ───────────────────────────────────────────────────────────────
function encodeCredentials(creds: WorkflowConnectorCredentials | undefined): string | null {
  if (!creds) return null;
  const clean = Object.fromEntries(Object.entries(creds).filter(([, v]) => v != null && v !== ''));
  if (Object.keys(clean).length === 0) return null;
  return encryptField(JSON.stringify(clean));
}
function decodeCredentials(enc: string | null): WorkflowConnectorCredentials {
  if (!enc) return {};
  const plain = decryptField(enc);
  if (!plain) return {};
  try { return JSON.parse(plain) as WorkflowConnectorCredentials; } catch { return {}; }
}

// ─── 映射（脱敏，绝不回传凭据明文）──────────────────────────────────────────────
async function mapConnector(row: WorkflowConnectorRow): Promise<WorkflowConnector> {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description ?? null,
    type: row.type as WorkflowConnectorType,
    config: (row.config ?? {}) as Record<string, unknown>,
    timeoutMs: row.timeoutMs,
    retryMax: row.retryMax,
    circuitBreakerEnabled: row.circuitBreakerEnabled,
    failureThreshold: row.failureThreshold,
    cooldownSec: row.cooldownSec,
    status: row.status as 'enabled' | 'disabled',
    hasCredentials: !!row.credentialsEncrypted,
    breakerState: await breakerState(row.id, row.circuitBreakerEnabled),
    tenantId: row.tenantId ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function findConnector(id: number): SQL {
  const tc = tenantCondition(workflowConnectors, currentUser());
  const conds = [eq(workflowConnectors.id, id)];
  if (tc) conds.push(tc);
  return and(...conds)!;
}

async function ensureConnector(id: number): Promise<WorkflowConnectorRow> {
  const [row] = await db.select().from(workflowConnectors).where(findConnector(id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '连接器不存在' });
  return row;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────
export async function listWorkflowConnectors(query: { page?: number; pageSize?: number; keyword?: string; type?: WorkflowConnectorType; status?: 'enabled' | 'disabled' }) {
  const { page = 1, pageSize = 10, keyword, type, status } = query;
  const tc = tenantCondition(workflowConnectors, currentUser());
  const conds: SQL[] = [];
  if (tc) conds.push(tc);
  if (type) conds.push(eq(workflowConnectors.type, type));
  if (status) conds.push(eq(workflowConnectors.status, status));
  if (keyword?.trim()) {
    const kw = `%${escapeLike(keyword.trim())}%`;
    conds.push(or(ilike(workflowConnectors.name, kw), ilike(workflowConnectors.code, kw))!);
  }
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(workflowConnectors, where),
    db.select().from(workflowConnectors).where(where).orderBy(desc(workflowConnectors.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  const list = await Promise.all(rows.map(mapConnector));
  return { list, total, page, pageSize };
}

export async function getWorkflowConnector(id: number): Promise<WorkflowConnector> {
  return mapConnector(await ensureConnector(id));
}

export async function createWorkflowConnector(input: CreateWorkflowConnectorInput): Promise<WorkflowConnector> {
  const tenantId = getCreateTenantId(currentUser());
  try {
    const [row] = await db.insert(workflowConnectors).values({
      name: input.name,
      code: input.code,
      description: input.description ?? null,
      type: input.type ?? 'http',
      config: (input.config ?? {}) as Record<string, unknown>,
      credentialsEncrypted: encodeCredentials(input.credentials),
      timeoutMs: input.timeoutMs ?? 10000,
      retryMax: input.retryMax ?? 0,
      circuitBreakerEnabled: input.circuitBreakerEnabled ?? true,
      failureThreshold: input.failureThreshold ?? 5,
      cooldownSec: input.cooldownSec ?? 60,
      status: input.status ?? 'enabled',
      tenantId,
    }).returning();
    return mapConnector(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '连接器编码已存在');
    throw err;
  }
}

export async function updateWorkflowConnector(id: number, input: UpdateWorkflowConnectorInput): Promise<WorkflowConnector> {
  const existing = await ensureConnector(id);
  const patch: Partial<typeof workflowConnectors.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.code !== undefined) patch.code = input.code;
  if (input.description !== undefined) patch.description = input.description ?? null;
  if (input.type !== undefined) patch.type = input.type;
  if (input.config !== undefined) patch.config = input.config as Record<string, unknown>;
  if (input.timeoutMs !== undefined) patch.timeoutMs = input.timeoutMs;
  if (input.retryMax !== undefined) patch.retryMax = input.retryMax;
  if (input.circuitBreakerEnabled !== undefined) patch.circuitBreakerEnabled = input.circuitBreakerEnabled;
  if (input.failureThreshold !== undefined) patch.failureThreshold = input.failureThreshold;
  if (input.cooldownSec !== undefined) patch.cooldownSec = input.cooldownSec;
  if (input.status !== undefined) patch.status = input.status;
  // 凭据：clearCredentials=清空；传 credentials=覆盖；都不传=保留原凭据
  if (input.clearCredentials) patch.credentialsEncrypted = null;
  else if (input.credentials !== undefined) patch.credentialsEncrypted = encodeCredentials(input.credentials);
  try {
    const [row] = await db.update(workflowConnectors).set(patch).where(eq(workflowConnectors.id, existing.id)).returning();
    return mapConnector(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '连接器编码已存在');
    throw err;
  }
}

export async function deleteWorkflowConnector(id: number): Promise<void> {
  const existing = await ensureConnector(id);
  await db.delete(workflowConnectors).where(eq(workflowConnectors.id, existing.id));
  await breakerReset(existing.id);
}

// ─── 运行时调用 ───────────────────────────────────────────────────────────────
function buildUrl(baseUrl: string, path: string | undefined, query: Record<string, string>): string {
  let url = baseUrl ?? '';
  if (path) {
    url = /^https?:\/\//i.test(path) ? path : `${url.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  }
  const qs = Object.keys(query).length ? new URLSearchParams(query).toString() : '';
  if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  return url;
}

function buildHeaders(cfg: WorkflowConnectorHttpConfig, creds: WorkflowConnectorCredentials, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(cfg.headers ?? {}), ...(extra ?? {}) };
  switch (cfg.authType) {
    case 'bearer':
      if (creds.token) headers['Authorization'] = `Bearer ${creds.token}`;
      break;
    case 'basic':
      if (creds.username != null) headers['Authorization'] = `Basic ${Buffer.from(`${creds.username}:${creds.password ?? ''}`).toString('base64')}`;
      break;
    case 'apiKey':
      if (creds.apiKey) headers[cfg.apiKeyHeader || 'X-API-Key'] = creds.apiKey;
      break;
    default:
      break;
  }
  return headers;
}

export type ConnectorInvocationSource = 'test' | 'trigger' | 'external' | 'webhook' | 'manual';

export interface ConnectorInvokeOptions {
  path?: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  /** IM 通知类型（wecom/dingtalk/feishu）的消息文本；缺省时回退 body */
  message?: string;
  /** 调用来源（审计/统计） */
  source?: ConnectorInvocationSource;
}

interface BuiltRequest { url: string; method: string; headers: Record<string, string>; body: unknown }

function fail(error: string): WorkflowConnectorInvokeResult {
  return { ok: false, status: null, durationMs: 0, responseSnippet: null, error };
}

function extractMessage(opts: ConnectorInvokeOptions): string {
  if (opts.message != null) return opts.message;
  if (typeof opts.body === 'string') return opts.body;
  if (opts.body != null) { try { return JSON.stringify(opts.body); } catch { return String(opts.body); } }
  return '';
}

/** IM 机器人 adapter：把通用消息文本转成各平台的 webhook body（baseUrl=机器人 webhook 地址） */
function buildImRequest(connector: WorkflowConnectorRow, opts: ConnectorInvokeOptions): BuiltRequest {
  const cfg = (connector.config ?? {}) as WorkflowConnectorHttpConfig;
  const text = extractMessage(opts);
  let body: Record<string, unknown>;
  if (connector.type === 'wecom') body = { msgtype: 'markdown', markdown: { content: text } };
  else if (connector.type === 'dingtalk') body = { msgtype: 'markdown', markdown: { title: '工作流通知', text } };
  else body = { msg_type: 'text', content: { text } }; // feishu
  return {
    url: buildUrl(cfg.baseUrl, opts.path, { ...(cfg.query ?? {}), ...(opts.query ?? {}) }),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.headers ?? {}), ...(opts.headers ?? {}) },
    body,
  };
}

/** HTTP/Webhook adapter：套用鉴权/凭据 */
function buildHttpRequest(connector: WorkflowConnectorRow, opts: ConnectorInvokeOptions): BuiltRequest {
  const cfg = (connector.config ?? {}) as WorkflowConnectorHttpConfig;
  const creds = decodeCredentials(connector.credentialsEncrypted);
  const method = (opts.method ?? cfg.method ?? 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'DELETE' && opts.body != null;
  return {
    url: buildUrl(cfg.baseUrl, opts.path, { ...(cfg.query ?? {}), ...(opts.query ?? {}) }),
    method,
    headers: buildHeaders(cfg, creds, opts.headers),
    body: hasBody ? opts.body : undefined,
  };
}

/** 写一条调用审计（best-effort，不影响主流程） */
async function recordInvocation(connector: WorkflowConnectorRow, url: string, result: WorkflowConnectorInvokeResult, source: ConnectorInvocationSource): Promise<void> {
  try {
    await db.insert(workflowConnectorInvocations).values({
      connectorId: connector.id,
      source,
      ok: result.ok,
      status: result.status ?? null,
      durationMs: result.durationMs,
      requestUrl: url ? url.slice(0, 1024) : null,
      error: result.error ? result.error.slice(0, 1024) : null,
      tenantId: connector.tenantId ?? null,
    });
  } catch { /* best-effort */ }
}

/** 公共 HTTP 执行：超时/重试 + 熔断记账 + 调用审计 */
async function executeHttp(connector: WorkflowConnectorRow, req: BuiltRequest, cbCfg: { enabled: boolean; failureThreshold: number; cooldownSec: number }, source: ConnectorInvocationSource): Promise<WorkflowConnectorInvokeResult> {
  const started = Date.now();
  let result: WorkflowConnectorInvokeResult;
  try {
    const resp = await httpRequest(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body == null ? undefined : (req.body as Record<string, unknown>),
      timeout: connector.timeoutMs,
      retries: connector.retryMax,
    });
    const durationMs = Date.now() - started;
    const snippet = (await resp.text().catch(() => '')).slice(0, 2000);
    if (resp.ok) {
      await breakerSuccess(connector.id);
      result = { ok: true, status: resp.status, durationMs, responseSnippet: snippet || null, error: null };
    } else {
      await breakerFailure(connector.id, cbCfg);
      result = { ok: false, status: resp.status, durationMs, responseSnippet: snippet || null, error: `HTTP ${resp.status}` };
    }
  } catch (err) {
    await breakerFailure(connector.id, cbCfg);
    result = { ok: false, status: null, durationMs: Date.now() - started, responseSnippet: null, error: err instanceof Error ? err.message : String(err) };
  }
  await recordInvocation(connector, req.url, result, source);
  return result;
}

const RUNTIME_SUPPORTED = new Set<string>(['http', 'webhook', 'wecom', 'dingtalk', 'feishu']);

/**
 * 运行时调用连接器：按 type 选择 adapter（http/webhook 透传；wecom/dingtalk/feishu 通知 adapter），
 * 套用超时/重试 + 熔断保护 + 调用审计。供触发器/外部审批/事件 Webhook 节点统一复用。
 */
export async function invokeConnector(connector: WorkflowConnectorRow, opts: ConnectorInvokeOptions = {}): Promise<WorkflowConnectorInvokeResult> {
  const source = opts.source ?? 'manual';
  if (connector.status !== 'enabled') {
    const r = fail('连接器已禁用'); await recordInvocation(connector, '', r, source); return r;
  }
  if (!RUNTIME_SUPPORTED.has(connector.type)) {
    return fail(`连接器类型「${connector.type}」暂未支持运行时调用`);
  }
  const cfg = (connector.config ?? {}) as WorkflowConnectorHttpConfig;
  if (!cfg.baseUrl) {
    const r = fail('连接器未配置 baseUrl'); await recordInvocation(connector, '', r, source); return r;
  }
  const cbCfg = { enabled: connector.circuitBreakerEnabled, failureThreshold: connector.failureThreshold, cooldownSec: connector.cooldownSec };
  const gate = await breakerAllow(connector.id, cbCfg);
  if (!gate.allowed) {
    const r = fail('熔断已打开，快速失败'); await recordInvocation(connector, cfg.baseUrl, r, source); return r;
  }
  const isIm = connector.type === 'wecom' || connector.type === 'dingtalk' || connector.type === 'feishu';
  const req = isIm ? buildImRequest(connector, opts) : buildHttpRequest(connector, opts);
  return executeHttp(connector, req, cbCfg, source);
}

/** 一键测试：对已存在连接器发一次探测请求。 */
export async function testWorkflowConnector(id: number, input: TestWorkflowConnectorInput): Promise<WorkflowConnectorInvokeResult> {
  const row = await ensureConnector(id);
  return invokeConnector(row, { path: input.path, method: input.method, body: input.body, source: 'test' });
}

/** 按 code 取连接器（供运行时业务桥接按 code 引用）。 */
export async function getConnectorRowByCode(code: string): Promise<WorkflowConnectorRow | null> {
  const tc = tenantCondition(workflowConnectors, currentUser());
  const conds = [eq(workflowConnectors.code, code)];
  if (tc) conds.push(tc);
  const [row] = await db.select().from(workflowConnectors).where(and(...conds)).limit(1);
  return row ?? null;
}

/**
 * 按 id 取连接器（运行时调用，无租户过滤、无需登录上下文）。
 * connectorId 来自流程定义快照，已在设计期按租户可见性约束，运行时直接信任。
 */
export async function getConnectorRowById(id: number): Promise<WorkflowConnectorRow | null> {
  const [row] = await db.select().from(workflowConnectors).where(eq(workflowConnectors.id, id)).limit(1);
  return row ?? null;
}

/** 连接器调用统计（按时间窗聚合：总数/成功/失败/成功率/平均耗时）。 */
export async function getConnectorStats(id: number, days = 7) {
  await ensureConnector(id); // 租户鉴权
  const since = new Date(Date.now() - Math.max(1, days) * 86400_000);
  const [r] = await db.select({
    total: sql<number>`count(*)::int`,
    success: sql<number>`count(*) filter (where ${workflowConnectorInvocations.ok})::int`,
    avgMs: sql<number>`coalesce(round(avg(${workflowConnectorInvocations.durationMs})), 0)::int`,
  }).from(workflowConnectorInvocations)
    .where(and(eq(workflowConnectorInvocations.connectorId, id), gte(workflowConnectorInvocations.createdAt, since)));
  const total = r?.total ?? 0;
  const success = r?.success ?? 0;
  return { connectorId: id, windowDays: days, total, success, failed: total - success, successRate: total ? Math.round((success / total) * 1000) / 1000 : 0, avgDurationMs: r?.avgMs ?? 0 };
}

/** 连接器最近调用记录。 */
export async function listConnectorInvocations(id: number, limit = 20) {
  await ensureConnector(id);
  const rows = await db.select().from(workflowConnectorInvocations)
    .where(eq(workflowConnectorInvocations.connectorId, id))
    .orderBy(desc(workflowConnectorInvocations.id))
    .limit(Math.min(100, Math.max(1, limit)));
  return rows.map((row) => ({
    id: row.id, source: row.source, ok: row.ok, status: row.status ?? null,
    durationMs: row.durationMs, requestUrl: row.requestUrl ?? null, error: row.error ?? null,
    createdAt: formatDateTime(row.createdAt),
  }));
}
