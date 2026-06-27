/**
 * 开放 API 网关（对外）：/api/open/v1/*
 *   - 鉴权方式：HMAC 签名（X-App-Key + 可选签名头），非管理员 Bearer Token
 *   - 经过 openSignatureAuth → openApiMetering → openRateLimit 三层网关中间件
 *   - 这里提供若干演示端点，使签名验签 / 限流套餐 / 调用统计端到端可用
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { okBody, errBody } from '../lib/openapi-schemas';
import { formatDateTime } from '../lib/datetime';
import { openSignatureAuth, openApiMetering, openRateLimit } from '../middleware/open-gateway';

const router = new Hono();

// 网关三层中间件（顺序：鉴权 → 计量 → 限流 → 业务）
router.use('/v1/*', openSignatureAuth, openApiMetering, openRateLimit);

/** scope 校验：记录本次所需 scope；未授权返回 false */
function hasScope(c: Context, scope: string): boolean {
  c.set('openScope', scope);
  const app = c.get('openApp');
  return app?.allowedScopes?.includes(scope) ?? false;
}

// GET /v1/ping —— 连通性测试（无需 scope）
router.get('/v1/ping', (c) => {
  const app = c.get('openApp');
  return c.json(okBody({ pong: true, app: app?.name ?? null, time: formatDateTime(new Date()) }), 200);
});

// GET /v1/echo —— 回显查询参数（scope: data:read）
router.get('/v1/echo', (c) => {
  if (!hasScope(c, 'data:read')) return c.json(errBody('应用未授权 scope：data:read', 403), 403);
  const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  return c.json(okBody({ query }), 200);
});

// POST /v1/echo —— 回显 JSON 请求体（scope: data:write，用于演示带 body 的签名）
router.post('/v1/echo', async (c) => {
  if (!hasScope(c, 'data:write')) return c.json(errBody('应用未授权 scope：data:write', 403), 403);
  let body: unknown = null;
  try {
    body = await c.req.json();
  } catch {
    // 非 JSON body，按 null 处理
  }
  return c.json(okBody({ body }), 200);
});

// GET /v1/userinfo —— 返回当前应用信息（scope: user:read）
router.get('/v1/userinfo', (c) => {
  if (!hasScope(c, 'user:read')) return c.json(errBody('应用未授权 scope：user:read', 403), 403);
  const app = c.get('openApp');
  return c.json(okBody({
    appKey: app?.clientId ?? null,
    appName: app?.name ?? null,
    scopes: app?.allowedScopes ?? [],
  }), 200);
});

export default router;
