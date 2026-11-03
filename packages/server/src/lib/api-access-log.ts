import type { Context } from 'hono';
import { db } from '../db';
import { apiAccessLogs, type IotDeviceRow, type NewApiAccessLog } from '../db/schema';
import type { JwtPayload } from '../middleware/auth';
import type { MemberJwtPayload } from '../middleware/member-auth';
import type { OpenPrincipal } from '../middleware/open-gateway';
import logger from './logger';
import { clampAuditJson } from './audit-clamp';
import { redactBody, truncateVarchar } from './sanitize';
import { getClientIp, getPlatformVersion, resolveRequestClient } from './request-helpers';
import { lookupIpLocation } from './ip-location';
import { getEffectiveTenantId } from './tenant';
import { PROCESS_HOSTNAME, PROCESS_PID } from './process-identity';
import { config } from '../config';

/** 契约元数据独立于审计门禁：未登录、无权限与校验失败的访问也能定位到操作。 */
export interface ApiAccessOperationContext {
  operationKey: string;
  operationName: string;
  module: string | null;
  operationType: string;
  recordBody: boolean;
}

declare module 'hono' {
  interface ContextVariableMap { apiAccessOperation?: ApiAccessOperationContext }
}

export const API_ACCESS_BODY_MAX_BYTES = 16 * 1024;
const MAX_QUERY_KEYS = 32;
const MAX_QUERY_BYTES = 8 * 1024;
const MAX_SNAPSHOT_NODES = 256;
const EXCLUDED_PREFIXES = ['/api/health', '/api/metrics', '/api/ws', '/api/openapi.json', '/api/docs', '/api/console-logs', '/api/log-files', '/api/log-viewer'];
const CREDENTIAL_PATH = /(?:^|\/)(?:auth|oauth|oauth2|signatures?|credentials?|secrets?|passwords?|tokens?)(?:\/|$)/i;
const EXTRA_SECRET_KEY = /^(?:code|otp|pin|signature|sign|key|session|sessionid|ticket|assertion|samlresponse|samlrequest)$/i;
const BODY_NOT_READY = Symbol('body-not-ready');

export function shouldCaptureApiAccessPath(path: string): boolean {
  return path.startsWith('/api/') && !EXCLUDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function sensitiveKey(key: string): boolean {
  // Check original names before clipping: a long '...password' key must stay redacted.
  const redacted = redactBody({ [key]: true }) as Record<string, unknown>;
  return redacted[key] === '***' || EXTRA_SECRET_KEY.test(key);
}

/** Bounded traversal before serialization; the handler's parsed JSON may be large. */
function boundedBody(value: unknown): unknown {
  let remaining = MAX_SNAPSHOT_NODES;
  const visit = (node: unknown, depth: number): unknown => {
    if (--remaining < 0 || depth > 6) return '[truncated]';
    if (typeof node === 'string') return node.slice(0, 1024);
    if (node == null || typeof node === 'number' || typeof node === 'boolean') return node;
    if (Array.isArray(node)) return node.slice(0, 20).map((item) => visit(item, depth + 1));
    if (typeof node !== 'object') return '[omitted]';
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let keys = 0;
    for (const key in node) {
      if (!Object.hasOwn(node, key)) continue;
      if (++keys > 32 || remaining <= 0) { out._truncated = true; break; }
      out[key.slice(0, 128)] = sensitiveKey(key) ? '***' : visit((node as Record<string, unknown>)[key], depth + 1);
    }
    return out;
  };
  const result = clampAuditJson(visit(value, 0), API_ACCESS_BODY_MAX_BYTES);
  return result === undefined ? null : JSON.parse(result) as unknown;
}

/** No raw URL, headers or stream reads: only already parsed query/JSON values. */
export async function captureApiAccessRequest(c: Context): Promise<{ query: Record<string, string>; body: unknown }> {
  const query: Record<string, string> = {};
  let bytes = 0;
  for (const [key, value] of Object.entries(c.req.query()).slice(0, MAX_QUERY_KEYS)) {
    const name = key.slice(0, 128);
    const safeValue = sensitiveKey(key) ? '***' : value.slice(0, 1024);
    bytes += Buffer.byteLength(name) + Buffer.byteLength(safeValue);
    if (bytes > MAX_QUERY_BYTES) { query._truncated = 'true'; break; }
    query[name] = safeValue;
  }
  let body: unknown = null;
  const type = c.req.header('content-type')?.split(';')[0].trim().toLowerCase();
  const declaredLength = c.req.header('content-length');
  const tooLarge = declaredLength !== undefined && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > API_ACCESS_BODY_MAX_BYTES);
  if (!tooLarge && type === 'application/json' && !CREDENTIAL_PATH.test(c.req.path) && c.get('apiAccessOperation')?.recordBody !== false) {
    // Never clone/read an unconsumed stream for logging (body limits, uploads, live streams).
    const cache = (c.req as unknown as { bodyCache?: { json?: Promise<unknown>; text?: Promise<string> } }).bodyCache;
    if (cache?.json || cache?.text) {
      let skipPending: ReturnType<typeof setImmediate> | undefined;
      try {
        // Hono 4.13 caches json() as text. Only parse a complete bounded cached string.
        const cachedJson = cache.json ?? cache.text!.then((text) => Buffer.byteLength(text) <= API_ACCESS_BODY_MAX_BYTES ? JSON.parse(text) as unknown : null);
        const parsed = await Promise.race([cachedJson, new Promise<typeof BODY_NOT_READY>((resolve) => {
          skipPending = setImmediate(() => resolve(BODY_NOT_READY));
        })]);
        // Scalar JSON strings can themselves be credentials without a field name.
        if (parsed !== BODY_NOT_READY && parsed !== null && typeof parsed === 'object') body = boundedBody(parsed);
      } catch { /* malformed JSON has no safe structured body */ }
      finally { if (skipPending) clearImmediate(skipPending); }
    }
  }
  return { query, body };
}

function loggedPath(c: Context): string {
  // Tokens in path parameters are credentials too: retain their template only.
  return Object.keys(c.req.param()).some(sensitiveKey) ? c.req.routePath || c.req.path : c.req.path;
}

export function buildApiAccessLogEntry(c: Context, snapshot: Awaited<ReturnType<typeof captureApiAccessRequest>>, startedAt: number, startedTick: number): NewApiAccessLog {
  const user: JwtPayload | undefined = c.get('user');
  const member: MemberJwtPayload | undefined = c.get('member');
  const principal: OpenPrincipal | undefined = c.get('openPrincipal');
  const device: IotDeviceRow | undefined = c.get('iotDevice');
  const ip = getClientIp(c);
  const client = resolveRequestClient(c.req.header('user-agent') ?? '', getPlatformVersion(c), user?.os);
  const operation = c.get('apiAccessOperation');
  const error = c.error;
  return {
    tenantId: user ? getEffectiveTenantId(user) : member?.tenantId ?? principal?.tenantId ?? device?.tenantId ?? null,
    userId: user?.userId ?? principal?.userId ?? null,
    memberId: member?.memberId ?? null,
    clientId: principal?.app.clientId ?? null,
    username: truncateVarchar(user?.username ?? member?.identifier ?? device?.sn, 64),
    impersonatorId: user?.impersonation?.byUserId ?? null,
    impersonatorName: truncateVarchar(user?.impersonation?.byUsername, 64),
    principalType: user ? 'admin' : member ? 'member' : principal ? 'open-gateway' : device ? 'device' : 'anonymous',
    authType: user ? (user.authType ?? 'jwt') : member ? 'member-jwt' : principal?.channel ?? (device ? 'device-signature' : 'none'),
    method: c.req.method.slice(0, 16),
    path: loggedPath(c).slice(0, 512),
    routePath: truncateVarchar(c.req.routePath === '/*' ? undefined : c.req.routePath, 512),
    requestId: truncateVarchar(c.get('requestId'), 64),
    queryParams: snapshot.query,
    requestBody: snapshot.body,
    module: truncateVarchar(operation?.module, 128),
    operationKey: truncateVarchar(operation?.operationKey, 160),
    operationName: truncateVarchar(operation?.operationName, 256),
    operationType: truncateVarchar(operation?.operationType, 32),
    responseCode: c.res.status,
    durationMs: Math.min(2_147_483_647, Math.max(0, Math.round(performance.now() - startedTick))),
    errorName: truncateVarchar(error?.name, 128),
    // Raw exception messages can embed URL credentials or SQL parameters. Look up the
    // scrubbed error event by requestId instead of duplicating that unstructured text.
    errorMessage: error ? `HTTP ${c.res.status}` : null,
    serviceName: truncateVarchar(config.otel.serviceName, 128),
    processRole: config.roles.label,
    hostname: PROCESS_HOSTNAME.slice(0, 128),
    pid: PROCESS_PID,
    ip: truncateVarchar(ip, 64),
    location: truncateVarchar(lookupIpLocation(ip), 128),
    userAgent: truncateVarchar(c.req.header('user-agent'), 512),
    os: client.os === 'Unknown' ? null : client.os.slice(0, 64),
    browser: client.browser === 'Unknown' ? null : client.browser.slice(0, 64),
    createdAt: new Date(startedAt),
  };
}

/** Bounded batch sink with counters; no database work starts on the request stack. */
export function createApiAccessLogBuffer(write: (entries: NewApiAccessLog[]) => Promise<unknown>) {
  const queue: NewApiAccessLog[] = [];
  const stats = { accepted: 0, stored: 0, dropped: 0, flushFailures: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  let lastWarn = 0;
  const warn = () => {
    if (Date.now() - lastWarn < 30_000) return;
    lastWarn = Date.now();
    logger.warn('[api-access-log] entries dropped', { ...stats, pending: queue.length });
  };
  const flush = (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (inFlight) return inFlight;
    if (queue.length === 0) return Promise.resolve();
    inFlight = (async () => {
      while (queue.length > 0) {
        const batch = queue.splice(0, 100);
        try { await write(batch); stats.stored += batch.length; }
        catch (error) {
          stats.flushFailures += 1;
          stats.dropped += batch.length;
          // Report the SQLSTATE only: database errors may otherwise embed the request snapshot.
          const raw = error as { code?: string; cause?: { code?: string } };
          const code = raw.code ?? raw.cause?.code ?? null;
          if (stats.flushFailures === 1) logger.warn('[api-access-log] persistence failed', { sqlState: code, errorType: error instanceof Error ? error.name : typeof error });
          warn();
        }
      }
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  };
  return {
    enqueue(entry: NewApiAccessLog): void {
      if (stopped) { stats.dropped += 1; return; }
      stats.accepted += 1;
      if (queue.length >= 2_000) { stats.dropped += 1; warn(); return; }
      queue.push(entry);
      if (!timer && !inFlight) timer = setTimeout(() => { void flush().catch(warn); }, 50).unref();
    },
    flush,
    async stop(): Promise<void> { stopped = true; await flush(); },
    stats: () => ({ ...stats, pending: queue.length, flushing: inFlight !== undefined }),
  };
}

const buffer = createApiAccessLogBuffer(async (entries) => { await db.insert(apiAccessLogs).values(entries); });
export const enqueueApiAccessLog = buffer.enqueue;
export const flushApiAccessLogs = buffer.flush;
export const stopApiAccessLogs = buffer.stop;
export const apiAccessLogStats = buffer.stats;
