import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { JwtPayload } from './auth';
import { setAuditBefore, type AppEnv } from '../lib/context';
import { isSuperAdmin, getUserPermissions } from '../lib/permissions';
import { sanitizeBody } from '../lib/sanitize';
import { db } from '../db';
import { operationLogs } from '../db/schema';
import { errBody } from '../lib/openapi-schemas';
import { getClientIp, parseUserAgent } from '../lib/request-helpers';
import { lookupIpLocation } from '../lib/ip-location';

export interface AuditLogOptions {
  description: string;
  module?: string;
  /** 是否记录请求体，默认 true；文件上传等场景传 false */
  recordBody?: boolean;
}

/** 在路由处理器中调用，记录操作前的实体快照，用于 diff 展示 */
export function setAuditBeforeData(_c: Context, data: unknown): void {
  setAuditBefore(data);
}

export interface GuardOptions {
  /** 需要的权限码，传字符串或数组（满足其一即可） */
  permission?: string | string[];
  /** 审计日志配置；不传则不记录操作日志 */
  audit?: AuditLogOptions;
}

async function writeOperationLog(
  c: Context,
  options: AuditLogOptions,
  durationMs: number,
  requestBody: unknown,
  beforeData: string | undefined,
  afterData: string | undefined,
  responseBody: string | undefined,
) {
  try {
    const user = c.get('user') as JwtPayload | undefined;
    const ip = getClientIp(c);
    const ua = c.req.header('user-agent') ?? '';
    const { browser: browserName, os: osName } = parseUserAgent(ua);

    const responseCode = c.res?.status ?? 200;
    const bodyStr =
      options.recordBody !== false && requestBody !== undefined
        ? sanitizeBody(requestBody).slice(0, 4096)
        : undefined;

    await db.insert(operationLogs).values({
      userId: user?.userId ?? null,
      username: user?.username ?? null,
      module: options.module ?? null,
      description: options.description,
      method: c.req.method,
      path: c.req.path,
      requestId: (c.get('requestId') as string | undefined) ?? null,
      requestBody: bodyStr ?? null,
      beforeData: beforeData ?? null,
      afterData: afterData ?? null,
      responseCode,
      responseBody: responseBody ?? null,
      durationMs,
      ip,
      location: ip ? lookupIpLocation(ip) : null,
      userAgent: ua.slice(0, 512) || null,
      os: osName === 'Unknown' ? null : osName,
      browser: browserName === 'Unknown' ? null : browserName,
    });
  } catch {
    // 日志写入失败不影响主流程
  }
}

async function resolveAuditRequestBody(c: Context, options: AuditLogOptions): Promise<unknown> {
  if (options.recordBody === false) {
    return undefined;
  }

  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined;
  }

  // 优先读已通过校验的数据（校验成功时可用）
  const request = c.req as typeof c.req & { valid: (target: 'json') => unknown };
  const validated = request.valid('json');
  if (validated !== undefined) return validated;

  // fallback：校验失败（400）时仍能记录原始请求体，便于审计异常请求
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/**
 * 统一路由守卫中间件。
 * 按顺序执行：权限校验 → 审计日志（可选）→ next()
 */
export function guard(opts: GuardOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    // ── 权限校验 ──
    if (opts.permission) {
      const user = c.get('user');
      if (!isSuperAdmin(user.roles)) {
        const perms = Array.isArray(opts.permission)
          ? opts.permission
          : [opts.permission];
        const userPerms = await getUserPermissions(user.userId);
        const hasPermission = perms.some((p) => userPerms.includes(p));
        if (!hasPermission) {
          return c.json(errBody('权限不足', 403), 403);
        }
      }
    }

    // ── 审计日志 ──
    if (opts.audit) {
      const start = Date.now();
      await next();
      const body = await resolveAuditRequestBody(c, opts.audit);
      // 捕获操作前快照（由路由处理器通过 setAuditBeforeData 注入）
      const beforeData = c.get('auditBeforeData') as string | undefined;
      // 捕获响应体作为操作后快照，同时记录完整响应体
      let afterData: string | undefined;
      let responseBodyStr: string | undefined;
      try {
        const cloned = c.res.clone();
        const rawText = await cloned.text();
        // 完整响应体（限长 16KB，避免超大 payload）
        if (rawText) responseBodyStr = rawText.length > 16384 ? `${rawText.slice(0, 16384)}…` : rawText;
        const resJson = JSON.parse(rawText) as { code?: number; data?: unknown };
        if (resJson.code === 0 && resJson.data != null) {
          afterData = JSON.stringify(resJson.data);
        }
      } catch {
        // 响应体非 JSON 或无 data，忽略
      }
      const durationMs = Date.now() - start;
      const auditOpts = opts.audit;
      setImmediate(() => {
        writeOperationLog(c, auditOpts, durationMs, body, beforeData, afterData, responseBodyStr).catch(() => {});
      });
      return;
    }

    await next();
  });
}
