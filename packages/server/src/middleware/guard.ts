import type { Context, MiddlewareHandler, Next } from 'hono';
import { UAParser } from 'ua-parser-js';
import type { JwtPayload } from './auth';
import { isSuperAdmin, getUserPermissions } from '../lib/permissions';
import { sanitizeBody } from '../lib/sanitize';
import { db } from '../db';
import { operationLogs } from '../db/schema';

export interface AuditLogOptions {
  description: string;
  module?: string;
  /** 是否记录请求体，默认 true；文件上传等场景传 false */
  recordBody?: boolean;
}

/** 在路由处理器中调用，记录操作前的实体快照，用于 diff 展示 */
export function setAuditBeforeData(c: Context, data: unknown): void {
  c.set('auditBeforeData', JSON.stringify(data));
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
) {
  try {
    const user = c.get('user') as JwtPayload | undefined;
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
      c.req.header('x-real-ip') ||
      '127.0.0.1';
    const ua = c.req.header('user-agent') ?? '';
    const parser = new UAParser(ua);
    const browser = parser.getBrowser();
    const os = parser.getOS();

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
      requestBody: bodyStr ?? null,
      beforeData: beforeData ?? null,
      afterData: afterData ?? null,
      responseCode,
      durationMs,
      ip,
      userAgent: ua.slice(0, 512) || null,
      os: os.name ? `${os.name} ${os.version ?? ''}`.trim() : null,
      browser: browser.name ? `${browser.name} ${browser.version ?? ''}`.trim() : null,
    });
  } catch {
    // 日志写入失败不影响主流程
  }
}

/**
 * 统一路由守卫中间件。
 * 按顺序执行：权限校验 → 审计日志（可选）→ next()
 */
export function guard(opts: GuardOptions): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    // ── 权限校验 ──
    if (opts.permission) {
      const user = c.get('user') as JwtPayload;
      if (!isSuperAdmin(user.roles)) {
        const perms = Array.isArray(opts.permission)
          ? opts.permission
          : [opts.permission];
        const userPerms = await getUserPermissions(user.userId);
        const hasPermission = perms.some((p) => userPerms.includes(p));
        if (!hasPermission) {
          return c.json({ code: 403, message: '权限不足', data: null }, 403);
        }
      }
    }

    // ── 审计日志 ──
    if (opts.audit) {
      const start = Date.now();
      let body: unknown;
      if (opts.audit.recordBody !== false) {
        const contentType = c.req.header('content-type') ?? '';
        if (contentType.includes('application/json')) {
          try { body = await c.req.json(); } catch { body = undefined; }
        }
      }
      await next();
      // 捕获操作前快照（由路由处理器通过 setAuditBeforeData 注入）
      const beforeData = c.get('auditBeforeData') as string | undefined;
      // 捕获响应体作为操作后快照
      let afterData: string | undefined;
      try {
        const cloned = c.res.clone();
        const resJson = await cloned.json() as { code?: number; data?: unknown };
        if (resJson.code === 0 && resJson.data != null) {
          afterData = JSON.stringify(resJson.data);
        }
      } catch {
        // 响应体非 JSON 或无 data，忽略
      }
      writeOperationLog(c, opts.audit, Date.now() - start, body, beforeData, afterData).catch(() => {});
      return;
    }

    await next();
  };
}
