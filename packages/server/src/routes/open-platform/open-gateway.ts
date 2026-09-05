/**
 * 开放 API 网关（对外）：/api/open/v1/*
 *   - 鉴权方式：HMAC 签名（X-App-Key + 可选签名头），非管理员 Bearer Token
 *   - 鉴权方式：OAuth2 Bearer 令牌，或 AppKey + HMAC 签名（详见 middleware/open-gateway）
 *   - 经过 openGatewayAuth → openApiMetering → openRateLimit 三层网关中间件
 *   - 这里提供若干演示端点，使签名验签 / 限流套餐 / 调用统计端到端可用
 *   - CMS Headless 端点见 ./open-cms（走同一条中间件链，挂载在 /v1/cms 下）
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { openGatewayContract } from '@zenith/shared/open-platform';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, errBody, validationHook } from '../../lib/openapi-schemas';
import { formatDateTime } from '../../lib/datetime';
import { openGatewayAuth, openApiMetering, openRateLimit } from '../../middleware/open-gateway';
import { decide } from '../../services/platform/rules-runtime.service';
import openCmsRoutes, { OPEN_CMS_ENDPOINTS } from './open-cms';
import openIotRoutes, { OPEN_IOT_ENDPOINTS } from './open-iot';
import openPaymentRoutes, { OPEN_PAYMENT_ENDPOINTS } from './open-payment';

/**
 * 必须是 OpenAPIHono 而非普通 Hono：`OpenAPIHono.route()` 只在**父子都是 OpenAPIHono**
 * 时才把子路由的 openAPIRegistry 合并上来。父级用普通 Hono 会让 open-cms 的定义
 * 在这一层被静默丢弃，端点能正常访问但不会出现在 openapi.json / Swagger 里。
 */
const router = new OpenAPIHono({ defaultHook: validationHook });

// 网关三层中间件（顺序：鉴权 → 计量 → 限流 → 业务）
router.use('/v1/*', openGatewayAuth, openApiMetering, openRateLimit);

// CMS Headless 端点（挂在中间件之后，共用同一条鉴权/计量/限流链；契约路径已含 /v1 前缀）
router.route('/', openCmsRoutes);

// IoT 设备查询与控制端点（同上）
router.route('/v1', openIotRoutes);

// 支付开放端点（身份、计量和限流继续复用同一网关）。
router.route('/v1', openPaymentRoutes);

/** 各核心端点所需 scope；同时供端点目录展示，null = 无需 scope */
const CORE_ENDPOINT_SCOPES = {
  ping: null,
  echoQuery: 'data:read',
  echoBody: 'data:write',
  userinfo: 'user:read',
  evaluateRule: 'rules:evaluate',
  createShortLink: 'data:write',
  shortLinkStats: 'data:read',
} as const satisfies Record<Exclude<keyof typeof openGatewayContract, 'basePath'>, string | null>;

/** scope 校验：记录本次所需 scope；以 principal 的有效 scope 为准（令牌级而非应用级） */
function hasScope(c: Context, scope: string): boolean {
  c.set('openScope', scope);
  return c.get('openPrincipal')?.scopes.includes(scope) ?? false;
}

const scopeDenied = (scope: string) => errBody(`应用未授权 scope：${scope}`, 403);

// GET /v1/ping —— 连通性测试（无需 scope）
const ping = defineContractRoute(openGatewayContract.ping, {
  middleware: [],
  handler: (c) => {
    const principal = c.get('openPrincipal');
    return c.json(okBody({
      pong: true,
      app: principal?.app.name ?? null,
      environment: principal?.app.environment ?? 'production',
      channel: principal?.channel ?? null,
      time: formatDateTime(new Date()),
    }), 200);
  },
});

// GET /v1/echo —— 回显查询参数（scope: data:read）
const echoQuery = defineContractRoute(openGatewayContract.echoQuery, {
  middleware: [],
  handler: (c) => {
    if (!hasScope(c, CORE_ENDPOINT_SCOPES.echoQuery)) return c.json(scopeDenied(CORE_ENDPOINT_SCOPES.echoQuery), 403);
    const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
    return c.json(okBody({ query }), 200);
  },
});

// POST /v1/echo —— 回显 JSON 请求体（scope: data:write，用于演示带 body 的签名）
const echoBody = defineContractRoute(openGatewayContract.echoBody, {
  middleware: [],
  handler: (c) => {
    if (!hasScope(c, CORE_ENDPOINT_SCOPES.echoBody)) return c.json(scopeDenied(CORE_ENDPOINT_SCOPES.echoBody), 403);
    return c.json(okBody({ body: c.req.valid('json') }), 200);
  },
});

// GET /v1/userinfo —— 返回当前调用主体信息（scope: user:read）
const userinfo = defineContractRoute(openGatewayContract.userinfo, {
  middleware: [],
  handler: (c) => {
    if (!hasScope(c, CORE_ENDPOINT_SCOPES.userinfo)) return c.json(scopeDenied(CORE_ENDPOINT_SCOPES.userinfo), 403);
    const principal = c.get('openPrincipal');
    return c.json(okBody({
      appKey: principal?.app.clientId ?? null,
      appName: principal?.app.name ?? null,
      environment: principal?.app.environment ?? 'production',
      channel: principal?.channel ?? null,
      userId: principal?.userId ?? null,
      scopes: principal?.scopes ?? [],
    }), 200);
  },
});

// POST /v1/rules/evaluate —— 规则中心统一求值（scope: rules:evaluate）
// 只允许求值已发布的平台级资产；kind=list 需传 subjects（待检测主体值集合）
const evaluateRule = defineContractRoute(openGatewayContract.evaluateRule, {
  middleware: [],
  handler: async (c) => {
    if (!hasScope(c, CORE_ENDPOINT_SCOPES.evaluateRule)) return c.json(scopeDenied(CORE_ENDPOINT_SCOPES.evaluateRule), 403);
    const { kind, key, facts, subjects } = c.req.valid('json');
    const principal = c.get('openPrincipal');
    try {
      const decision = await decide(
        { kind, key },
        facts ?? {},
        {
          caller: `open.${principal?.app.clientId ?? 'unknown'}`.slice(0, 64),
          mode: 'required',
          source: 'open',
          tenantId: null,
          subjects,
        },
      );
      return c.json(okBody(decision), 200);
    } catch (err) {
      if (err instanceof HTTPException) return c.json(errBody(err.message, err.status), err.status as 400);
      return c.json(errBody('规则求值失败，请检查 facts 输入', 400), 400);
    }
  },
});

// ─── 短链服务（scope: data:write / data:read）────────────────────────────────
// POST /v1/short-links —— 生成短链（支持自定义短码 / 标题 / 有效期）
const createShortLink = defineContractRoute(openGatewayContract.createShortLink, {
  middleware: [],
  handler: async (c) => {
    if (!hasScope(c, CORE_ENDPOINT_SCOPES.createShortLink)) return c.json(scopeDenied(CORE_ENDPOINT_SCOPES.createShortLink), 403);
    const body = c.req.valid('json');
    const principal = c.get('openPrincipal');
    const { createOpenShortLink } = await import('../../services/short-link/short-link.service');
    try {
      const link = await createOpenShortLink(
        { targetUrl: body.targetUrl.trim(), code: body.code, title: body.title?.trim() || null, expiresAt: body.expiresAt?.trim() || null },
        principal?.app.name ?? principal?.app.clientId ?? 'unknown',
      );
      return c.json(okBody({ code: link.code, shortUrl: link.shortUrl, targetUrl: link.targetUrl, expiresAt: link.expiresAt }), 200);
    } catch (err) {
      if (err instanceof HTTPException) return c.json(errBody(err.message, err.status), err.status as 400);
      throw err;
    }
  },
});

// GET /v1/short-links/{code}/stats —— 短链访问统计（趋势/汇总）
const shortLinkStats = defineContractRoute(openGatewayContract.shortLinkStats, {
  middleware: [],
  handler: async (c) => {
    if (!hasScope(c, CORE_ENDPOINT_SCOPES.shortLinkStats)) return c.json(scopeDenied(CORE_ENDPOINT_SCOPES.shortLinkStats), 403);
    const { code } = c.req.valid('param');
    const { days } = c.req.valid('query');
    const { findShortLinkByCode } = await import('../../services/short-link/short-link.service');
    const link = await findShortLinkByCode(code);
    if (!link) return c.json(errBody('短链不存在', 404), 404);
    const { computeShortLinkStats } = await import('../../services/short-link/short-link-stats.service');
    const stats = await computeShortLinkStats(link.id, days);
    return c.json(okBody({ code: link.code, shortUrl: link.shortUrl, totals: stats.totals, trend: stats.trend }), 200);
  },
});

router.openapiRoutes([ping, echoQuery, echoBody, userinfo, evaluateRule, createShortLink, shortLinkStats] as const);

export default router;

/**
 * 开放 API 端点目录：核心端点（由本文件契约派生）+ CMS / IoT / 支付子端点（各自派生）。
 * 供 API 调试台列出可调用端点，避免前端硬编码一份很快过期的清单。
 */
export const OPEN_GATEWAY_ENDPOINTS: Array<{
  method: string;
  path: string;
  summary: string;
  scope: string | null;
}> = [
  ...(Object.keys(CORE_ENDPOINT_SCOPES) as Array<keyof typeof CORE_ENDPOINT_SCOPES>).map((name) => {
    const operation = openGatewayContract[name];
    return { method: operation.method.toUpperCase(), path: operation.fullPath, summary: operation.summary, scope: CORE_ENDPOINT_SCOPES[name] };
  }),
  ...OPEN_CMS_ENDPOINTS.map((item) => ({ ...item, scope: null })),
  ...OPEN_IOT_ENDPOINTS,
  ...OPEN_PAYMENT_ENDPOINTS,
];
