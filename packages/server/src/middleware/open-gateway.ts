/**
 * 开放 API 网关中间件：
 *   1. openGatewayAuth  —— 双通道鉴权，产出统一 principal
 *   2. openApiMetering   —— 异步记录调用日志，供「调用统计」聚合
 *   3. openRateLimit     —— 按限流套餐对 AppKey 做 QPS / 日 / 月配额限制
 *
 * 三者顺序挂载：openGatewayAuth → openApiMetering → openRateLimit → handler
 *
 * ── 鉴权模型（统一 principal，双通道）────────────────────────────────────────
 *
 * 通道 A「OAuth2 Bearer」：`Authorization: Bearer oat_xxx`
 *   适用于用户授权场景与免签名的服务端集成（client_credentials）。
 *   有效 scope = 令牌被授予的 scope ∩ 应用允许的 scope（用户授权粒度在调用侧真正生效）。
 *
 * 通道 B「AppKey + HMAC 签名」：`X-App-Key` + `X-Timestamp` / `X-Nonce` / `X-Signature`
 *   适用于金融级机器对机器集成，仅当应用显式开启签名通道（signEnabled）时可用。
 *   有效 scope = 应用允许的全部 scope（无用户主体）。
 *   **签名在该通道下强制**：不存在「裸 AppKey 免签名」路径——client_id 是公开信息，
 *   单凭它调用等同于零鉴权。需要免签名接入请改用通道 A。
 *
 * 两条通道最终都产出同一个 `openPrincipal`，下游 scope 校验只认 principal.scopes。
 */
import type { MiddlewareHandler } from 'hono';
import dayjs from 'dayjs';
import ipRangeCheck from 'ip-range-check';
import redis from '../lib/redis';
import { config } from '../config';
import { errBody } from '../lib/openapi-schemas';
import { getClientIp } from '../lib/request-helpers';
import logger from '../lib/logger';
import { OPEN_SIGNATURE_HEADERS as H, OPEN_SIGNATURE_TIMESTAMP_WINDOW } from '@zenith/shared/open-platform';
import { signRequest, timingSafeEqualHex } from '../lib/open-signature';
import { getOpenApiApp, recordOpenApiCall, type OpenApiAppContext } from '../services/open-platform/open-gateway.service';
import { resolveAccessToken } from '../services/open-platform/oauth2-auth.service';
import { getRatePlanRowById, getDefaultRatePlanRow } from '../services/open-platform/rate-plans.service';
import { openEventBus } from '../lib/open-event-bus';
import { maybeSendQuotaWarning } from '../services/open-platform/open-quota-alerts.service';
import { APP_TIME_ZONE } from '../lib/datetime';

/** 网关调用主体：两条鉴权通道归一后的统一结果 */
export interface OpenPrincipal {
  app: OpenApiAppContext;
  tenantId: number | null;
  /** 鉴权通道：bearer = OAuth2 令牌；signature = AppKey + HMAC */
  channel: 'bearer' | 'signature';
  /** 用户授权令牌对应的用户；client_credentials 与签名通道为 null */
  userId: number | null;
  /** 本次调用的有效 scope（已与应用允许范围取交集） */
  scopes: string[];
}

declare module 'hono' {
  interface ContextVariableMap {
    openApp: OpenApiAppContext;
    /** 统一调用主体，scope 校验的唯一依据 */
    openPrincipal: OpenPrincipal;
    /** 处理器声明的本次调用所需 scope，供计量记录 */
    openScope: string | undefined;
  }
}

const PREFIX = `${config.redis.keyPrefix}openrl:`;
const NONCE_PREFIX = `${config.redis.keyPrefix}opennonce:`;

// ─── 1. 双通道鉴权 ────────────────────────────────────────────────────────────

/** 应用可用性检查：状态、审核、IP 白名单。返回错误响应体或 null */
function checkAppUsable(c: Parameters<MiddlewareHandler>[0], app: OpenApiAppContext): { message: string; status: 401 | 403 } | null {
  if (app.status !== 'enabled') return { message: '应用已禁用', status: 403 };
  if (
    config.openPlatform.gatewayRequireApproval
    && app.environment === 'production'
    && app.reviewStatus !== 'approved'
  ) {
    return { message: '应用尚未审核通过', status: 403 };
  }
  if (app.ipAllowlist.length > 0) {
    const clientIp = getClientIp(c);
    const allowed = app.ipAllowlist.some((range) => {
      try {
        return ipRangeCheck(clientIp, range);
      } catch {
        return false;
      }
    });
    if (!allowed) return { message: '当前 IP 不在应用白名单中', status: 403 };
  }
  return null;
}

/** 通道 B：校验 HMAC 签名（时间戳窗口 + nonce 防重放 + 多密钥验签） */
async function verifySignature(
  c: Parameters<MiddlewareHandler>[0],
  app: OpenApiAppContext,
): Promise<{ message: string } | null> {
  const timestamp = c.req.header(H.timestamp);
  const nonce = c.req.header(H.nonce);
  const signature = c.req.header(H.signature);
  if (!timestamp || !nonce || !signature) {
    return { message: `缺少签名请求头（${H.timestamp} / ${H.nonce} / ${H.signature}）` };
  }
  const tsNum = Number(timestamp);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(tsNum) || Math.abs(nowSec - tsNum) > OPEN_SIGNATURE_TIMESTAMP_WINDOW) {
    return { message: '签名时间戳已过期' };
  }
  if (app.signingSecrets.length === 0) {
    return { message: '该应用未配置签名密钥（请重置应用密钥）' };
  }
  const nonceKey = `${NONCE_PREFIX}${app.clientId}:${nonce}`;
  const fresh = await redis.set(nonceKey, '1', 'EX', OPEN_SIGNATURE_TIMESTAMP_WINDOW * 2, 'NX');
  if (fresh === null) return { message: '重复请求（nonce 已使用）' };

  let rawBody = '';
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    try {
      rawBody = await c.req.raw.clone().text();
    } catch {
      rawBody = '';
    }
  }
  const url = new URL(c.req.url);
  const matched = app.signingSecrets.some((secret) => {
    const { signature: expected } = signRequest(secret, {
      method: c.req.method,
      path: url.pathname,
      query: url.search,
      timestamp,
      nonce,
      body: rawBody,
    });
    return timingSafeEqualHex(signature, expected);
  });
  return matched ? null : { message: '签名校验失败' };
}

export const openGatewayAuth: MiddlewareHandler = async (c, next) => {
  const authorization = c.req.header('Authorization');
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : null;
  const appKey = c.req.header(H.appKey);

  let principal: OpenPrincipal;

  if (bearer) {
    // ── 通道 A：OAuth2 Bearer ──
    const resolved = await resolveAccessToken(bearer);
    if (!resolved) return c.json(errBody('invalid_token', 401), 401);
    const app = await getOpenApiApp(resolved.clientId);
    if (!app) return c.json(errBody('invalid_token', 401), 401);
    const usable = checkAppUsable(c, app);
    if (usable) return c.json(errBody(usable.message, usable.status), usable.status);
    // 有效 scope = 令牌授予 ∩ 应用允许（应用被收窄权限后，存量令牌同步降权）
    const scopes = resolved.scopes.filter((s) => app.allowedScopes.includes(s));
    principal = { app, tenantId: app.tenantId, channel: 'bearer', userId: resolved.userId, scopes };
  } else if (appKey) {
    // ── 通道 B：AppKey + HMAC 签名（签名强制）──
    const app = await getOpenApiApp(appKey);
    if (!app) return c.json(errBody('AppKey 无效', 401), 401);
    const usable = checkAppUsable(c, app);
    if (usable) return c.json(errBody(usable.message, usable.status), usable.status);
    if (!app.signEnabled) {
      return c.json(errBody('该应用未开启签名通道，请改用 OAuth2 Bearer 令牌调用', 401), 401);
    }
    const sigErr = await verifySignature(c, app);
    if (sigErr) return c.json(errBody(sigErr.message, 401), 401);
    principal = { app, tenantId: app.tenantId, channel: 'signature', userId: null, scopes: [...app.allowedScopes] };
  } else {
    return c.json(errBody(`缺少鉴权信息：请提供 Authorization: Bearer 令牌，或 ${H.appKey} 与签名请求头`, 401), 401);
  }

  c.set('openPrincipal', principal);
  c.set('openApp', principal.app);
  c.header('X-Zenith-Environment', principal.app.environment);
  await next();
};

/** 开放子路由统一 Scope 门禁，同时记录计量维度。 */
export function requireOpenScope(scope: string): MiddlewareHandler {
  return async (c, next) => {
    c.set('openScope', scope);
    if (!c.get('openPrincipal')?.scopes.includes(scope)) {
      return c.json(errBody(`应用未授权 scope：${scope}`, 403), 403);
    }
    await next();
  };
}

/** 资金写接口只接受 AppKey + HMAC 通道，拒绝普通 OAuth Bearer。 */
export const requireOpenSignatureChannel: MiddlewareHandler = async (c, next) => {
  if (c.get('openPrincipal')?.channel !== 'signature') {
    return c.json(errBody('支付写接口必须使用 AppKey + HMAC 签名通道', 403), 403);
  }
  await next();
};

// ─── 2. 按套餐限流 ────────────────────────────────────────────────────────────

async function incrWithExpire(key: string, ttlSeconds: number): Promise<number> {
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, ttlSeconds);
  return n;
}

function currentSecond(): string {
  return String(Math.floor(Date.now() / 1000));
}

/**
 * 配额超限事件（节流）。
 *
 * 限流本身就是高频突发场景：一次流量尖峰可以在一秒内打出成百上千个 429。若每个被拒请求
 * 都发一次事件，Webhook 订阅方会收到投递洪水，反而在故障时雪上加霜。这里与配额预警
 * （maybeSendQuotaWarning）采用同一套 Redis gate 思路：同一「应用 + 维度 + 周期」在
 * 冷却窗口内只发一次。gate 获取失败时直接跳过，绝不阻塞主请求。
 */
const QUOTA_EXCEEDED_GATE_TTL: Record<'qps' | 'daily' | 'monthly', number> = {
  qps: 60,                  // QPS 超限：每分钟最多一条
  daily: 60 * 60,           // 日配额超限：每小时最多一条
  monthly: 6 * 60 * 60,     // 月配额超限：每 6 小时最多一条
};

async function emitQuotaExceeded(
  clientId: string,
  limit: 'qps' | 'daily' | 'monthly',
  period: string,
  value: number,
  planCode: string,
): Promise<void> {
  try {
    const gateKey = `${config.redis.keyPrefix}openquota-exceeded:${clientId}:${limit}:${period}`;
    const acquired = await redis.set(gateKey, '1', 'EX', QUOTA_EXCEEDED_GATE_TTL[limit], 'NX');
    if (acquired === null) return;
    openEventBus.emit({ type: 'app.quota.exceeded', clientId, data: { limit, value, plan: planCode } });
  } catch (err) {
    logger.warn('[open-gateway] quota exceeded event gate failed', { clientId, limit, err });
  }
}

export const openRateLimit: MiddlewareHandler = async (c, next) => {
  const app = c.get('openApp');
  if (!app) return next();
  const isPaymentRequest = new URL(c.req.url).pathname.startsWith('/api/open/v1/payments');
  if (app.environment === 'sandbox' && !isPaymentRequest) return next();

  const plan = app.ratePlanId ? await getRatePlanRowById(app.ratePlanId) : await getDefaultRatePlanRow();
  if (!plan || plan.status !== 'enabled') return next();

  try {
    if (plan.qpsLimit > 0) {
      const n = await incrWithExpire(`${PREFIX}qps:${app.clientId}`, 1);
      if (n > plan.qpsLimit) {
        await emitQuotaExceeded(app.clientId, 'qps', currentSecond(), plan.qpsLimit, plan.code);
        return c.json(errBody(`超出套餐 QPS 限制（${plan.qpsLimit}/s）`, 429), 429, { 'Retry-After': '1' });
      }
    }
    if (plan.dailyQuota > 0) {
      const day = dayjs().tz(APP_TIME_ZONE).format('YYYY-MM-DD');
      const n = await incrWithExpire(`${PREFIX}daily:${app.clientId}:${day}`, 2 * 24 * 60 * 60);
      if (n >= plan.dailyQuota * 0.8) {
        await maybeSendQuotaWarning({
          clientId: app.clientId,
          dimension: 'daily',
          period: day,
          used: n,
          limit: plan.dailyQuota,
          planCode: plan.code,
          gateTtlSeconds: 2 * 24 * 60 * 60,
        }).catch((err) => logger.error('[open-gateway] daily quota warning failed', err));
      }
      if (n > plan.dailyQuota) {
        await emitQuotaExceeded(app.clientId, 'daily', day, plan.dailyQuota, plan.code);
        return c.json(errBody(`超出套餐每日调用配额（${plan.dailyQuota}/天）`, 429), 429);
      }
    }
    if (plan.monthlyQuota > 0) {
      const month = dayjs().tz(APP_TIME_ZONE).format('YYYY-MM');
      const n = await incrWithExpire(`${PREFIX}monthly:${app.clientId}:${month}`, 32 * 24 * 60 * 60);
      if (n >= plan.monthlyQuota * 0.8) {
        await maybeSendQuotaWarning({
          clientId: app.clientId,
          dimension: 'monthly',
          period: month,
          used: n,
          limit: plan.monthlyQuota,
          planCode: plan.code,
          gateTtlSeconds: 32 * 24 * 60 * 60,
        }).catch((err) => logger.error('[open-gateway] monthly quota warning failed', err));
      }
      if (n > plan.monthlyQuota) {
        await emitQuotaExceeded(app.clientId, 'monthly', month, plan.monthlyQuota, plan.code);
        return c.json(errBody(`超出套餐每月调用配额（${plan.monthlyQuota}/月）`, 429), 429);
      }
    }
  } catch (err) {
    logger.error('[open-gateway] rate-limit check failed', err);
    if (config.openPlatform.rateLimitFailClosed) {
      return c.json(errBody('限流服务暂时不可用，请稍后重试', 503), 503);
    }
  }
  await next();
};

// ─── 3. 调用计量 ──────────────────────────────────────────────────────────────

export const openApiMetering: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const durationMs = Date.now() - start;
  const principal = c.get('openPrincipal');
  const app = principal?.app;
  const url = new URL(c.req.url);
  const statusCode = c.res.status;
  recordOpenApiCall({
    clientId: app?.clientId ?? 'unknown',
    appName: app?.name ?? null,
    method: c.req.method,
    path: url.pathname,
    statusCode,
    success: statusCode < 400,
    durationMs,
    ip: getClientIp(c),
    userAgent: (c.req.header('user-agent') ?? '').slice(0, 256) || null,
    scope: c.get('openScope') ?? null,
    authChannel: principal?.channel ?? null,
    userId: principal?.userId ?? null,
    correlationId: c.res.headers.get('x-request-id'),
    environment: app?.environment ?? 'production',
  }).catch(() => undefined);

  // 触发开放平台事件，供 Webhook 订阅投递
  if (app) {
    if (statusCode === 403) {
      openEventBus.emit({ type: 'app.scope.denied', clientId: app.clientId, data: { method: c.req.method, path: url.pathname, scope: c.get('openScope') ?? null } });
    } else if (statusCode >= 400 && statusCode !== 429) {
      openEventBus.emit({ type: 'app.call.failed', clientId: app.clientId, data: { method: c.req.method, path: url.pathname, statusCode } });
    }
  }
};
