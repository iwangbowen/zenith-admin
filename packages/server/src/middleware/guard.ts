import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { JwtPayload } from './auth';
import { setAuditAfter, setAuditBefore, type AppEnv } from '../lib/context';
import { isSuperAdmin, getUserPermissions } from '../lib/permissions';
import { clampAuditJson, sliceUtf8Text, AUDIT_REQUEST_BODY_BUDGET_BYTES, AUDIT_SNAPSHOT_BUDGET_BYTES } from '../lib/audit-clamp';
import { redactBody, truncateVarchar } from '../lib/sanitize';
import { db } from '../db';
import { operationLogs } from '../db/schema';
import { errBody } from '../lib/openapi-schemas';
import { getClientIp, getPlatformVersion, parseUserAgent } from '../lib/request-helpers';
import { lookupIpLocation } from '../lib/ip-location';
import { getEffectiveTenantId } from '../lib/tenant';
import { assertFeatureEnabled } from '../lib/licensing';
import type { LicenseFeatureKey } from '@zenith/shared/licensing';
import { permissionList, type Permission } from '@zenith/shared/core';
import { tagMiddleware } from '../lib/route-facts';

export interface AuditLogOptions {
  description: string;
  module?: string;
  /** 是否记录请求体，默认 true；文件上传等场景传 false */
  recordBody?: boolean;
  /** 是否记录完整响应体，默认 true；返回一次性密钥等敏感响应时传 false */
  recordResponseBody?: boolean;
}

/** 在路由处理器中调用，记录操作前的实体快照，用于 diff 展示 */
export function setAuditBeforeData(_c: Context, data: unknown): void {
  setAuditBefore(data);
}

/** 在路由处理器中调用，记录操作后的实体快照，用于响应 data 为 null 的变更操作 */
export function setAuditAfterData(_c: Context, data: unknown): void {
  setAuditAfter(data);
}

export interface GuardOptions {
  /** 需要的权限码，传单个或数组（满足其一即可）；只接受注册表里的码（`@zenith/shared/core` 的 `Permission`） */
  permission?: Permission | readonly Permission[];
  /** 所属可授权功能：License 检查不豁免超管（授权是部署级商业约束，不是权限问题） */
  feature?: LicenseFeatureKey;
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
    // 审计口径：只信服务端请求头 + Client Hints，不采纳客户端自报的展示值
    const { browser: browserName, os: osName } = parseUserAgent(ua, getPlatformVersion(c));

    const responseCode = c.res?.status ?? 200;
    // 脱敏 → 结构化裁剪：合法 JSON 且 UTF-8 字节 ≤ 4KB（不再用字符串 slice 切坏 JSON）
    const bodyStr =
      options.recordBody !== false && requestBody !== undefined
        ? clampAuditJson(redactBody(requestBody), AUDIT_REQUEST_BODY_BUDGET_BYTES)
        : undefined;

    await db.insert(operationLogs).values({
      userId: user?.userId ?? null,
      username: truncateVarchar(user?.username, 32),
      // 模拟登录：userId / username 是被模拟用户，这里记下实际操作人
      impersonatorId: user?.impersonation?.byUserId ?? null,
      impersonatorName: truncateVarchar(user?.impersonation?.byUsername, 32),
      module: options.module ?? null,
      description: options.description,
      method: c.req.method,
      path: truncateVarchar(c.req.path, 256) ?? '',
      requestId: (c.get('requestId') as string | undefined) ?? null,
      requestBody: bodyStr ?? null,
      beforeData: beforeData ?? null,
      afterData: afterData ?? null,
      responseCode,
      responseBody: responseBody ?? null,
      durationMs,
      ip: truncateVarchar(ip, 64),
      location: ip ? truncateVarchar(lookupIpLocation(ip), 128) : null,
      userAgent: truncateVarchar(ua, 512),
      os: osName === 'Unknown' ? null : truncateVarchar(osName, 64),
      browser: browserName === 'Unknown' ? null : truncateVarchar(browserName, 64),
      // 归属租户：租户用户记自身租户；平台超管在租户视角下记该租户，平台视角记 null
      tenantId: user ? getEffectiveTenantId(user) : null,
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
  const middleware = createMiddleware<AppEnv>(async (c, next) => {
    // ── License 功能门控（先于权限；超管不豁免）──
    if (opts.feature) {
      await assertFeatureEnabled(opts.feature);
    }

    // ── 权限校验 ──
    if (opts.permission) {
      const user = c.get('user');
      if (!isSuperAdmin(user)) {
        const perms = permissionList(opts.permission);
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
      const manualAfterData = c.get('auditAfterData') as string | undefined;
      const durationMs = Date.now() - start;
      const auditOpts = opts.audit;
      // clone 必须在响应流被消费前同步执行；body 读取与 JSON 解析延后到响应发出之后，
      // 避免为写审计日志而增加请求延迟
      const cloned = c.res.clone();
      setImmediate(() => {
        (async () => {
          // 捕获响应体作为操作后快照，同时记录完整响应体
          let afterData: string | undefined = manualAfterData;
          let responseBodyStr: string | undefined;
          try {
            const rawText = await cloned.text();
            let resJson: unknown;
            let isJson = false;
            try {
              resJson = JSON.parse(rawText);
              isJson = true;
            } catch {
              // 响应体非 JSON（纯文本 / 二进制等）
            }
            if (rawText && auditOpts.recordResponseBody !== false) {
              // JSON 响应结构化裁剪（保证合法）；非 JSON 按 UTF-8 字节安全截断，均 ≤ 16KB
              responseBodyStr = isJson
                ? clampAuditJson(resJson, AUDIT_SNAPSHOT_BUDGET_BYTES)
                : sliceUtf8Text(rawText, AUDIT_SNAPSHOT_BUDGET_BYTES);
            }
            if (afterData === undefined && isJson && resJson && typeof resJson === 'object') {
              const body = resJson as { code?: number; data?: unknown };
              if (body.code === 0 && body.data != null) {
                afterData = clampAuditJson(body.data, AUDIT_SNAPSHOT_BUDGET_BYTES);
              }
            }
          } catch {
            // 响应体读取失败，忽略
          }
          await writeOperationLog(c, auditOpts, durationMs, body, beforeData, afterData, responseBodyStr);
        })().catch(() => {});
      });
      return;
    }

    await next();
  });
  return tagMiddleware(middleware, {
    kind: 'guard',
    permission: opts.permission ? [...permissionList(opts.permission)] : null,
    audit: opts.audit ? { ...opts.audit } : null,
    feature: opts.feature ?? null,
  });
}
