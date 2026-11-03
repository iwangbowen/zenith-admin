import { db } from '../db';
import { apiAccessLogs, type NewApiAccessLog } from '../db/schema';
import logger from './logger';
import type { Context } from 'hono';
import { snapshotRequest } from './error-tracking/scrub';
import { getClientIp, getPlatformVersion, resolveRequestClient } from './request-helpers';
import { lookupIpLocation } from './ip-location';
import { getEffectiveTenantId } from './tenant';
import { PROCESS_HOSTNAME, PROCESS_PID } from './process-identity';
import { config } from '../config';

/** 契约路由在处理器执行前写入的操作元数据，供全局访问日志在响应结束后读取。 */
export interface ApiAccessOperationContext {
  operationKey: string;
  operationName: string;
  module: string | null;
  operationType: string;
}

export const API_ACCESS_BODY_MAX_BYTES = 16 * 1024;

export async function captureApiAccessRequest(c: Context) {
  return snapshotRequest(c, { captureBody: true, bodyMaxBytes: API_ACCESS_BODY_MAX_BYTES, extraKeys: [] });
}

export function buildApiAccessLogEntry(c: Context, snapshot: Awaited<ReturnType<typeof captureApiAccessRequest>>, startedAt: number): NewApiAccessLog {
  const user = c.get('user') as { userId: number; username: string; tenantId: number | null; impersonation?: { byUserId: number; byUsername: string }; authType?: string; os?: string } | undefined;
  const member = c.get('member') as { memberId: number; identifier: string; tenantId: number | null } | undefined;
  const principal = c.get('openPrincipal') as { tenantId: number | null; userId: number | null; channel: string; app?: { name?: string } } | undefined;
  const ip = getClientIp(c);
  const client = resolveRequestClient(c.req.header('user-agent') ?? '', getPlatformVersion(c), user?.os);
  const operation = c.get('apiAccessOperation');
  const error = c.get('apiAccessError');
  const tenantId = user ? getEffectiveTenantId(user as never) : member?.tenantId ?? principal?.tenantId ?? null;
  const principalType = user ? 'admin' : member ? 'member' : principal ? 'open-gateway' : 'anonymous';
  const authType = user?.authType ?? (member ? 'member-jwt' : principal?.channel ?? 'none');
  return {
    tenantId,
    userId: user?.userId ?? principal?.userId ?? null,
    username: user?.username ?? member?.identifier ?? null,
    impersonatorId: user?.impersonation?.byUserId ?? null,
    impersonatorName: user?.impersonation?.byUsername ?? null,
    principalType,
    authType,
    method: c.req.method,
    path: c.req.url.slice(0, 512),
    routePath: c.req.routePath?.slice(0, 512) ?? null,
    requestId: (c.get('requestId') as string | undefined) ?? null,
    queryParams: snapshot.query ?? null,
    requestBody: snapshot.body,
    module: operation?.module ?? null,
    operationKey: operation?.operationKey ?? null,
    operationName: operation?.operationName ?? null,
    operationType: operation?.operationType ?? null,
    responseCode: c.res.status,
    durationMs: Date.now() - startedAt,
    errorName: error?.name ?? null,
    errorMessage: error?.message?.slice(0, 512) ?? null,
    serviceName: config.otel.serviceName?.slice(0, 128) ?? 'zenith-admin',
    processRole: config.roles.label,
    hostname: PROCESS_HOSTNAME.slice(0, 128),
    pid: PROCESS_PID,
    ip: ip.slice(0, 64),
    location: lookupIpLocation(ip)?.slice(0, 128) ?? null,
    userAgent: (c.req.header('user-agent') ?? '').slice(0, 512) || null,
    os: client.os === 'Unknown' ? null : client.os.slice(0, 64),
    browser: client.browser === 'Unknown' ? null : client.browser.slice(0, 64),
  };
}

declare module 'hono' {
  interface ContextVariableMap {
    apiAccessOperation?: ApiAccessOperationContext;
    apiAccessError?: { name: string; message: string };
  }
}

const MAX_QUEUE_SIZE = 2_000;
const BATCH_SIZE = 100;
const FLUSH_DELAY_MS = 50;

const queue: NewApiAccessLog[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushing = false;

function scheduleFlush(): void {
  if (flushTimer !== undefined) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushApiAccessLogs();
  }, FLUSH_DELAY_MS);
  // The timer must not keep a worker/API process alive during shutdown.
  if (typeof flushTimer === 'object' && 'unref' in flushTimer) flushTimer.unref();
}

/**
 * 将访问日志放入有界内存队列。请求路径不等待数据库写入；队列满时丢弃最旧的一批，
 * 以保证日志故障不会把 API 主链路拖垮。
 */
export function enqueueApiAccessLog(entry: NewApiAccessLog): void {
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.splice(0, Math.max(BATCH_SIZE, Math.floor(MAX_QUEUE_SIZE / 10)));
    logger.warn('[api-access-log] queue full; oldest entries dropped');
  }
  queue.push(entry);
  if (queue.length >= BATCH_SIZE) void flushApiAccessLogs();
  else scheduleFlush();
}

/** 批量写入访问日志；导出供测试与优雅停机使用。 */
export async function flushApiAccessLogs(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, BATCH_SIZE);
  try {
    await db.insert(apiAccessLogs).values(batch);
  } catch (error) {
    logger.warn('[api-access-log] batch insert failed', { error: error instanceof Error ? error.message : String(error), count: batch.length });
  } finally {
    flushing = false;
    if (queue.length > 0) {
      if (queue.length >= BATCH_SIZE) void flushApiAccessLogs();
      else scheduleFlush();
    }
  }
}

