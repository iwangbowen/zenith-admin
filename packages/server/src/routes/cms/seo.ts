import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsRedirectSchema, updateCmsRedirectSchema, createCmsLinkWordSchema, updateCmsLinkWordSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, PaginationQuery, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { CmsRedirectDTO, CmsLinkWordDTO, CmsPushLogDTO, CmsPushResultDTO } from '../../lib/openapi-dtos';
import {
  listCmsRedirects, createCmsRedirect, updateCmsRedirect, deleteCmsRedirect, ensureCmsRedirectExists, mapCmsRedirect,
} from '../../services/cms/cms-redirects.service';
import {
  listCmsLinkWords, createCmsLinkWord, updateCmsLinkWord, deleteCmsLinkWord, ensureCmsLinkWordExists, mapCmsLinkWord,
} from '../../services/cms/cms-link-words.service';
import { pushCmsUrls, listCmsPushLogs } from '../../services/cms/cms-push.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

// ─── 301 重定向 ───────────────────────────────────────────────────────────────
const listRedirects = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/redirects',
    tags: ['CMS-SEO'], summary: '重定向规则列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:seo:manage' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        keyword: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsRedirectDTO, '规则列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsRedirects(c.req.valid('query'))), 200),
});

const createRedirect = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/redirects',
    tags: ['CMS-SEO'], summary: '创建重定向规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:seo:manage', audit: { description: '创建 CMS 重定向', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsRedirectSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsRedirectDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsRedirect(c.req.valid('json')), '创建成功'), 200),
});

const updateRedirect = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/redirects/{id}',
    tags: ['CMS-SEO'], summary: '更新重定向规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:seo:manage', audit: { description: '更新 CMS 重定向', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsRedirectSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsRedirectDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsRedirect(await ensureCmsRedirectExists(id)));
    return c.json(okBody(await updateCmsRedirect(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRedirect = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/redirects/{id}',
    tags: ['CMS-SEO'], summary: '删除重定向规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:seo:manage', audit: { description: '删除 CMS 重定向', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsRedirect(await ensureCmsRedirectExists(id)));
    await deleteCmsRedirect(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 内链词 ───────────────────────────────────────────────────────────────────
const listLinkWords = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/link-words',
    tags: ['CMS-SEO'], summary: '内链词列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:seo:manage' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        keyword: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsLinkWordDTO, '内链词列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsLinkWords(c.req.valid('query'))), 200),
});

const createLinkWord = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/link-words',
    tags: ['CMS-SEO'], summary: '创建内链词',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:seo:manage', audit: { description: '创建 CMS 内链词', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsLinkWordSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsLinkWordDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsLinkWord(c.req.valid('json')), '创建成功'), 200),
});

const updateLinkWord = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/link-words/{id}',
    tags: ['CMS-SEO'], summary: '更新内链词',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:seo:manage', audit: { description: '更新 CMS 内链词', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsLinkWordSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsLinkWordDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsLinkWord(await ensureCmsLinkWordExists(id)));
    return c.json(okBody(await updateCmsLinkWord(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteLinkWord = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/link-words/{id}',
    tags: ['CMS-SEO'], summary: '删除内链词',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:seo:manage', audit: { description: '删除 CMS 内链词', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsLinkWord(await ensureCmsLinkWordExists(id)));
    await deleteCmsLinkWord(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 搜索引擎推送 ─────────────────────────────────────────────────────────────
const pushRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/push',
    tags: ['CMS-SEO'], summary: '手动推送 URL 到搜索引擎（百度/IndexNow）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:seo:push', audit: { description: 'CMS 搜索引擎推送', module: 'CMS内容管理' } })] as const,
    request: {
      body: {
        content: jsonContent(z.object({
          siteId: z.number().int().positive(),
          urls: z.array(z.string().min(1).max(500)).min(1, '至少填写一个 URL').max(2000),
          engines: z.array(z.enum(['baidu', 'indexnow'])).optional(),
        })),
        required: true,
      },
    },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsPushResultDTO), '推送结果') },
  }),
  handler: async (c) => {
    const { siteId, urls, engines } = c.req.valid('json');
    return c.json(okBody(await pushCmsUrls(siteId, urls, engines), '推送完成'), 200);
  },
});

const pushLogsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/push-logs',
    tags: ['CMS-SEO'], summary: '推送日志',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:seo:manage' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        engine: z.enum(['baidu', 'indexnow']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsPushLogDTO, '推送日志') },
  }),
  handler: async (c) => c.json(okBody(await listCmsPushLogs(c.req.valid('query'))), 200),
});

router.openapiRoutes([
  listRedirects, createRedirect, updateRedirect, deleteRedirect,
  listLinkWords, createLinkWord, updateLinkWord, deleteLinkWord,
  pushRoute, pushLogsRoute,
] as const);

export default router;
