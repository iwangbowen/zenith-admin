/**
 * 开放 API 网关（对外）：/api/open/v1/*
 *   - 鉴权方式：HMAC 签名（X-App-Key + 可选签名头），非管理员 Bearer Token
 *   - 经过 openSignatureAuth → openApiMetering → openRateLimit 三层网关中间件
 *   - 这里提供若干演示端点，使签名验签 / 限流套餐 / 调用统计端到端可用
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { okBody, errBody } from '../../lib/openapi-schemas';
import { formatDateTime } from '../../lib/datetime';
import { openSignatureAuth, openApiMetering, openRateLimit } from '../../middleware/open-gateway';

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
  return c.json(okBody({
    pong: true,
    app: app?.name ?? null,
    environment: app?.environment ?? 'production',
    time: formatDateTime(new Date()),
  }), 200);
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
    environment: app?.environment ?? 'production',
    scopes: app?.allowedScopes ?? [],
  }), 200);
});

// ═══ CMS Headless 内容 API（scope: cms:read，只读已发布数据）═════════════════════

/** 解析 siteCode 参数为站点（未找到统一 404） */
async function resolveCmsSite(c: Context) {
  const siteCode = c.req.query('siteCode') ?? '';
  if (!siteCode) return null;
  const { resolveSiteByCode } = await import('../../services/cms/cms-sites.service');
  return resolveSiteByCode(siteCode);
}

// GET /v1/cms/channels?siteCode= —— 站点栏目树（启用中）
router.get('/v1/cms/channels', async (c) => {
  if (!hasScope(c, 'cms:read')) return c.json(errBody('应用未授权 scope：cms:read', 403), 403);
  const site = await resolveCmsSite(c);
  if (!site) return c.json(errBody('站点不存在（请携带 siteCode 参数）', 404), 404);
  const { listCmsChannelTree } = await import('../../services/cms/cms-channels.service');
  const tree = await listCmsChannelTree({ siteId: site.id, status: 'enabled' });
  return c.json(okBody(tree), 200);
});

// GET /v1/cms/contents?siteCode=&channelId=&page=&pageSize= —— 已发布内容分页
router.get('/v1/cms/contents', async (c) => {
  if (!hasScope(c, 'cms:read')) return c.json(errBody('应用未授权 scope：cms:read', 403), 403);
  const site = await resolveCmsSite(c);
  if (!site) return c.json(errBody('站点不存在（请携带 siteCode 参数）', 404), 404);
  const channelId = Number(c.req.query('channelId')) || 0;
  if (!channelId) return c.json(errBody('缺少 channelId 参数', 400), 400);
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(c.req.query('pageSize')) || 20));
  const { listPublishedContents, mapCmsContent } = await import('../../services/cms/cms-contents.service');
  const { total, rows } = await listPublishedContents(site.id, channelId, page, pageSize);
  const list = rows.map((row) => {
    const mapped = mapCmsContent(row);
    return { ...mapped, body: undefined }; // 列表不返回正文，减小载荷
  });
  return c.json(okBody({ list, total, page, pageSize }), 200);
});

// GET /v1/cms/contents/{id}?siteCode= —— 已发布内容详情（含正文）
router.get('/v1/cms/contents/:id', async (c) => {
  if (!hasScope(c, 'cms:read')) return c.json(errBody('应用未授权 scope：cms:read', 403), 403);
  const site = await resolveCmsSite(c);
  if (!site) return c.json(errBody('站点不存在（请携带 siteCode 参数）', 404), 404);
  const id = Number(c.req.param('id')) || 0;
  const { getPublishedContentById, mapCmsContent, listContentTags, resolveContentBodyExtend } = await import('../../services/cms/cms-contents.service');
  const row = id > 0 ? await getPublishedContentById(site.id, id) : null;
  if (!row) return c.json(errBody('内容不存在或未发布', 404), 404);
  const [tags, resolved] = await Promise.all([listContentTags(row.id), resolveContentBodyExtend(row)]);
  return c.json(okBody({ ...mapCmsContent(row, { tags }), body: resolved.body, extend: resolved.extend }), 200);
});

export default router;
