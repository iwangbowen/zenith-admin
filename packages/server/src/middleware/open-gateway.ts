/**
 * 开放 API 网关中间件：
 *   1. openSignatureAuth —— 按 AppKey 鉴权 + （可选）HMAC 签名验签 + 防重放
 *   2. openRateLimit     —— 按限流套餐对 AppKey 做 QPS / 日 / 月配额限制
 *   3. openApiMetering   —— 异步记录调用日志，供「调用统计」聚合
 *
 * 三者顺序挂载：openSignatureAuth → openApiMetering → openRateLimit → handler
 */
import type { MiddlewareHandler } from 'hono';
import dayjs from 'dayjs';
import redis from '../lib/redis';
import { config } from '../config';
import { errBody } from '../lib/openapi-schemas';
import { getClientIp } from '../lib/request-helpers';
import logger from '../lib/logger';
import {
  OPEN_SIGNATURE_HEADERS as H,
  OPEN_SIGNATURE_TIMESTAMP_WINDOW,
} from '@zenith/shared';
import { signRequest, timingSafeEqualHex } from '../lib/open-signature';
import { getOpenApiApp, recordOpenApiCall, type OpenApiAppContext } from '../services/open-gateway.service';
import { getRatePlanRowById, getDefaultRatePlanRow } from '../services/rate-plans.service';

declare module 'hono' {
  interface ContextVariableMap {
    openApp: OpenApiAppContext;
    /** 处理器声明的本次调用所需 scope，供计量记录 */
    openScope: string | undefined;
  }
}

const PREFIX = `${config.redis.keyPrefix}openrl:`;
const NONCE_PREFIX = `${config.redis.keyPrefix}opennonce:`;

// ─── 1. 签名鉴权 ──────────────────────────────────────────────────────────────

export const openSignatureAuth: MiddlewareHandler = async (c, next) => {
  const appKey = c.req.header(H.appKey);
  if (!appKey) {
    return c.json(errBody(`缺少 ${H.appKey} 请求头`, 401), 401);
  }

  const app = await getOpenApiApp(appKey);
  if (!app) return c.json(errBody('AppKey 无效', 401), 401);
  if (app.status !== 'enabled') return c.json(errBody('应用已禁用', 403), 403);

  if (app.signEnabled) {
    const timestamp = c.req.header(H.timestamp);
    const nonce = c.req.header(H.nonce);
    const signature = c.req.header(H.signature);
    if (!timestamp || !nonce || !signature) {
      return c.json(errBody(`缺少签名请求头（${H.timestamp} / ${H.nonce} / ${H.signature}）`, 401), 401);
    }
    // 时间戳窗口校验（防重放）
    const tsNum = Number(timestamp);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(tsNum) || Math.abs(nowSec - tsNum) > OPEN_SIGNATURE_TIMESTAMP_WINDOW) {
      return c.json(errBody('签名时间戳已过期', 401), 401);
    }
    if (!app.signingSecret) {
      return c.json(errBody('该应用未配置签名密钥（请重置应用密钥）', 401), 401);
    }
    // nonce 防重放
    const nonceKey = `${NONCE_PREFIX}${app.clientId}:${nonce}`;
    const fresh = await redis.set(nonceKey, '1', 'EX', OPEN_SIGNATURE_TIMESTAMP_WINDOW * 2, 'NX');
    if (fresh === null) {
      return c.json(errBody('重复请求（nonce 已使用）', 401), 401);
    }
    // 读取原始 body 参与签名
    let rawBody = '';
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      try {
        rawBody = await c.req.raw.clone().text();
      } catch {
        rawBody = '';
      }
    }
    const url = new URL(c.req.url);
    const { signature: expected } = signRequest(app.signingSecret, {
      method: c.req.method,
      path: url.pathname,
      query: url.search,
      timestamp,
      nonce,
      body: rawBody,
    });
    if (!timingSafeEqualHex(signature, expected)) {
      return c.json(errBody('签名校验失败', 401), 401);
    }
  }

  c.set('openApp', app);
  await next();
};

// ─── 2. 按套餐限流 ────────────────────────────────────────────────────────────

async function incrWithExpire(key: string, ttlSeconds: number): Promise<number> {
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, ttlSeconds);
  return n;
}

export const openRateLimit: MiddlewareHandler = async (c, next) => {
  const app = c.get('openApp');
  if (!app) return next();

  const plan = app.ratePlanId ? await getRatePlanRowById(app.ratePlanId) : await getDefaultRatePlanRow();
  if (!plan || plan.status !== 'enabled') return next();

  try {
    if (plan.qpsLimit > 0) {
      const n = await incrWithExpire(`${PREFIX}qps:${app.clientId}`, 1);
      if (n > plan.qpsLimit) {
        return c.json(errBody(`超出套餐 QPS 限制（${plan.qpsLimit}/s）`, 429), 429, { 'Retry-After': '1' });
      }
    }
    if (plan.dailyQuota > 0) {
      const day = dayjs().format('YYYY-MM-DD');
      const n = await incrWithExpire(`${PREFIX}daily:${app.clientId}:${day}`, 2 * 24 * 60 * 60);
      if (n > plan.dailyQuota) {
        return c.json(errBody(`超出套餐每日调用配额（${plan.dailyQuota}/天）`, 429), 429);
      }
    }
    if (plan.monthlyQuota > 0) {
      const month = dayjs().format('YYYY-MM');
      const n = await incrWithExpire(`${PREFIX}monthly:${app.clientId}:${month}`, 32 * 24 * 60 * 60);
      if (n > plan.monthlyQuota) {
        return c.json(errBody(`超出套餐每月调用配额（${plan.monthlyQuota}/月）`, 429), 429);
      }
    }
  } catch (err) {
    logger.warn('[open-gateway] rate-limit check failed', err);
  }
  await next();
};

// ─── 3. 调用计量 ──────────────────────────────────────────────────────────────

export const openApiMetering: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const durationMs = Date.now() - start;
  const app = c.get('openApp');
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
    requestId: c.res.headers.get('x-request-id'),
  }).catch(() => undefined);
};
