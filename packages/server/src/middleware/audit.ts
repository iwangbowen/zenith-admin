import type { Context, Next } from 'hono';
import { UAParser } from 'ua-parser-js';
import { db } from '../db';
import { operationLogs } from '../db/schema';
import { sanitizeBody } from '../lib/sanitize';
import type { JwtPayload } from './auth';

export interface AuditLogOptions {
  description: string;
  module?: string;
  /** 是否记录请求体，默认 true；文件上传等场景传 false */
  recordBody?: boolean;
}

async function writeOperationLog(
  c: Context,
  options: AuditLogOptions,
  durationMs: number,
  requestBody: unknown,
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

export function auditLog(options: AuditLogOptions) {
  return async (c: Context, next: Next) => {
    const start = Date.now();

    // 提前读取请求体（Hono 内部会缓存，handler 中仍可正常读取）
    let body: unknown;
    if (options.recordBody !== false) {
      const contentType = c.req.header('content-type') ?? '';
      if (contentType.includes('application/json')) {
        try {
          body = await c.req.json();
        } catch {
          body = undefined;
        }
      }
    }

    await next();

    // 异步写日志，不阻塞响应
    writeOperationLog(c, options, Date.now() - start, body).catch(() => {});
  };
}
