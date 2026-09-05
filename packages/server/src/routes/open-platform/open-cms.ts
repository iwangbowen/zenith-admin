/**
 * CMS Headless 开放 API。
 *
 * 端点由 `openCmsContract` 定义并进入 Swagger，客户端可直接由 openapi.json 生成 SDK。
 * 鉴权链：网关中间件（签名 → 计量 → 限流）已在 open-gateway 上挂载，
 * 本模块只负责 scope 校验、站点解析与业务编排。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { CMS_OPEN_SYNC_PAGE_SIZE_MAX, openCmsContract } from '@zenith/shared/cms';
import { contractOperations } from '@zenith/shared/core';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { decodeCmsOpenCursor, OpenQueryError, parseCmsOpenIncludes, parseCmsOpenQuery, parsePositiveInteger } from '../../lib/open-query';
import { idempotencyGuard } from '../../middleware/idempotency';
import { listCmsChannelTree } from '../../services/cms/cms-channels.service';
import { resolveSiteByCode } from '../../services/cms/cms-sites.service';
import { getOpenCmsContent, listOpenCmsContents, listOpenCmsContentsByCursor, syncOpenCmsContents } from '../../services/cms/cms-open.service';
import {
  createOpenCmsContent, publishOpenCmsContent, recycleOpenCmsContent,
  submitOpenCmsContent, updateOpenCmsContent,
} from '../../services/cms/cms-open-write.service';
import type { CmsSiteRow } from '../../db/schema';

const router = new OpenAPIHono({ defaultHook: validationHook });

// ─── scope 与站点解析 ────────────────────────────────────────────────────────

/** 声明本次调用所需 scope（供计量记录），未授权直接 403 */
function requireScope(scope: string): MiddlewareHandler {
  return async (c, next) => {
    c.set('openScope', scope);
    if (!c.get('openPrincipal')?.scopes.includes(scope)) {
      throw new HTTPException(403, { message: `应用未授权 scope：${scope}` });
    }
    await next();
  };
}

function hasScope(c: Context, scope: string): boolean {
  return c.get('openPrincipal')?.scopes.includes(scope) ?? false;
}

function clientIdOf(c: Context): string {
  const clientId = c.get('openPrincipal')?.app.clientId;
  if (!clientId) throw new HTTPException(401, { message: '缺少有效的调用主体' });
  return clientId;
}

async function requireSite(siteCode: string): Promise<CmsSiteRow> {
  const site = await resolveSiteByCode(siteCode);
  if (!site) throw new HTTPException(404, { message: `站点标识「${siteCode}」不存在` });
  if (site.status !== 'enabled') throw new HTTPException(404, { message: '站点已停用' });
  return site;
}

/** DSL 解析失败按 400 返回，而不是 500 */
function parseQuery(raw: Record<string, string>) {
  try {
    return parseCmsOpenQuery(raw);
  } catch (err) {
    if (err instanceof OpenQueryError) throw new HTTPException(400, { message: err.message });
    throw err;
  }
}

function rawQuery(c: Context): Record<string, string> {
  return Object.fromEntries(new URL(c.req.url).searchParams.entries());
}

const forbidden = { 403: { content: jsonContent(ErrorResponse), description: '应用未授权 scope 或站点' } } as const;
const conflict = { 409: { content: jsonContent(ErrorResponse), description: '版本冲突，请重新读取后再提交' } } as const;

// ─── 只读端点 ────────────────────────────────────────────────────────────────

const channelsRoute = defineContractRoute(openCmsContract.channels, {
  middleware: [requireScope('cms:read')],
  responses: forbidden,
  handler: async (c) => {
    const site = await requireSite(c.req.valid('query').siteCode);
    const tree = await listCmsChannelTree({ siteId: site.id, status: 'enabled' }, { skipAccessCheck: true });
    return c.json(okBody(tree), 200);
  },
});

const contentsRoute = defineContractRoute(openCmsContract.contents, {
  middleware: [requireScope('cms:read')],
  responses: forbidden,
  handler: async (c) => {
    const raw = rawQuery(c);
    const site = await requireSite(c.req.valid('query').siteCode);
    return c.json(okBody(await listOpenCmsContents(site, parseQuery(raw))), 200);
  },
});

const contentsCursorRoute = defineContractRoute(openCmsContract.contentsCursor, {
  middleware: [requireScope('cms:read')],
  responses: forbidden,
  handler: async (c) => {
    const raw = rawQuery(c);
    const site = await requireSite(c.req.valid('query').siteCode);
    return c.json(okBody(await listOpenCmsContentsByCursor(site, parseQuery(raw))), 200);
  },
});

const syncRoute = defineContractRoute(openCmsContract.sync, {
  middleware: [requireScope('cms:read')],
  responses: forbidden,
  handler: async (c) => {
    const query = c.req.valid('query');
    const site = await requireSite(query.siteCode);
    try {
      return c.json(okBody(await syncOpenCmsContents(site, {
        since: query.since ?? null,
        cursor: decodeCmsOpenCursor(query.cursor),
        pageSize: parsePositiveInteger(query.pageSize, 100, 'pageSize', CMS_OPEN_SYNC_PAGE_SIZE_MAX),
        includes: parseCmsOpenIncludes(query.include),
      })), 200);
    } catch (err) {
      if (err instanceof OpenQueryError) throw new HTTPException(400, { message: err.message });
      throw err;
    }
  },
});

const contentDetailRoute = defineContractRoute(openCmsContract.contentDetail, {
  middleware: [requireScope('cms:read')],
  responses: forbidden,
  handler: async (c) => {
    const raw = rawQuery(c);
    const site = await requireSite(c.req.valid('query').siteCode);
    const content = await getOpenCmsContent(site, c.req.valid('param').idOrSlug, parseQuery(raw));
    return c.json(okBody(content), 200);
  },
});

// ─── 写入端点 ────────────────────────────────────────────────────────────────

const createContentRoute = defineContractRoute(openCmsContract.createContent, {
  middleware: [requireScope('cms:write'), idempotencyGuard({ ttlSeconds: 30 })],
  responses: forbidden,
  handler: async (c) => {
    const site = await requireSite(c.req.valid('query').siteCode);
    const content = await createOpenCmsContent(
      site, clientIdOf(c), hasScope(c, 'cms:publish'), c.req.valid('json'),
    );
    return c.json(okBody(content, '创建成功'), 200);
  },
});

const updateContentRoute = defineContractRoute(openCmsContract.updateContent, {
  middleware: [requireScope('cms:write')],
  responses: { ...forbidden, ...conflict },
  handler: async (c) => {
    const site = await requireSite(c.req.valid('query').siteCode);
    const content = await updateOpenCmsContent(site, clientIdOf(c), c.req.valid('param').id, c.req.valid('json'));
    return c.json(okBody(content, '更新成功'), 200);
  },
});

const submitContentRoute = defineContractRoute(openCmsContract.submitContent, {
  middleware: [requireScope('cms:write')],
  responses: forbidden,
  handler: async (c) => {
    const site = await requireSite(c.req.valid('query').siteCode);
    const content = await submitOpenCmsContent(site, clientIdOf(c), c.req.valid('param').id);
    return c.json(okBody(content, '已提交审核'), 200);
  },
});

const publishContentRoute = defineContractRoute(openCmsContract.publishContent, {
  middleware: [requireScope('cms:publish')],
  responses: forbidden,
  handler: async (c) => {
    const site = await requireSite(c.req.valid('query').siteCode);
    const content = await publishOpenCmsContent(site, clientIdOf(c), true, c.req.valid('param').id);
    return c.json(okBody(content, '已发布'), 200);
  },
});

const deleteContentRoute = defineContractRoute(openCmsContract.recycleContent, {
  middleware: [requireScope('cms:write')],
  responses: forbidden,
  handler: async (c) => {
    const site = await requireSite(c.req.valid('query').siteCode);
    await recycleOpenCmsContent(site, clientIdOf(c), c.req.valid('param').id);
    return c.json(okBody(null, '已移入回收站'), 200);
  },
});

// 路径注册顺序有意义：/contents/sync 与 /contents/cursor 必须先于 /contents/{idOrSlug}，
// 否则会被通配参数吞掉
router.openapiRoutes([
  channelsRoute, contentsRoute, contentsCursorRoute, syncRoute, contentDetailRoute,
  createContentRoute, updateContentRoute, submitContentRoute, publishContentRoute, deleteContentRoute,
] as const);

/**
 * CMS 开放端点目录：由契约派生，供 API 调试台列出可调端点。
 */
export const OPEN_CMS_ENDPOINTS = contractOperations(openCmsContract).map((operation) => ({
  method: operation.method.toUpperCase(),
  path: operation.fullPath,
  summary: operation.summary,
}));

export default router;
