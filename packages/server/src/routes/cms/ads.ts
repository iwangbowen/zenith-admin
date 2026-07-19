import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsAdSlotSchema, updateCmsAdSlotSchema, createCmsAdSchema, updateCmsAdSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, PaginationQuery, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { CmsAdSlotDTO, CmsAdDTO } from '../../lib/openapi-dtos';
import {
  listCmsAdSlots, createCmsAdSlot, updateCmsAdSlot, deleteCmsAdSlot, ensureCmsAdSlotExists, mapCmsAdSlot,
  listCmsAds, createCmsAd, updateCmsAd, deleteCmsAd, ensureCmsAdExists, mapCmsAd,
} from '../../services/cms/cms-ads.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

// ─── 广告位 ───────────────────────────────────────────────────────────────────
const listSlots = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/slots',
    tags: ['CMS-广告管理'], summary: '广告位列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:ad:list' })] as const,
    request: { query: z.object({ siteId: z.coerce.number().int().positive() }) },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsAdSlotDTO), '广告位列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsAdSlots(c.req.valid('query').siteId)), 200),
});

const createSlot = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/slots',
    tags: ['CMS-广告管理'], summary: '创建广告位',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:ad:manage', audit: { description: '创建 CMS 广告位', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsAdSlotSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsAdSlotDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsAdSlot(c.req.valid('json')), '创建成功'), 200),
});

const updateSlot = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/slots/{id}',
    tags: ['CMS-广告管理'], summary: '更新广告位',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:ad:manage', audit: { description: '更新 CMS 广告位', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsAdSlotSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsAdSlotDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsAdSlot(await ensureCmsAdSlotExists(id)));
    return c.json(okBody(await updateCmsAdSlot(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteSlot = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/slots/{id}',
    tags: ['CMS-广告管理'], summary: '删除广告位',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:ad:manage', audit: { description: '删除 CMS 广告位', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsAdSlot(await ensureCmsAdSlotExists(id)));
    await deleteCmsAdSlot(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 广告投放 ─────────────────────────────────────────────────────────────────
const listAds = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-广告管理'], summary: '广告分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:ad:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        slotId: z.coerce.number().int().positive().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsAdDTO, '广告列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsAds(c.req.valid('query'))), 200),
});

const createAd = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-广告管理'], summary: '创建广告',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:ad:manage', audit: { description: '创建 CMS 广告', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsAdSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsAdDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsAd(c.req.valid('json')), '创建成功'), 200),
});

const updateAd = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-广告管理'], summary: '更新广告',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:ad:manage', audit: { description: '更新 CMS 广告', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsAdSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsAdDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsAd(await ensureCmsAdExists(id)));
    return c.json(okBody(await updateCmsAd(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteAd = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['CMS-广告管理'], summary: '删除广告',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:ad:manage', audit: { description: '删除 CMS 广告', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsAd(await ensureCmsAdExists(id)));
    await deleteCmsAd(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listSlots, createSlot, updateSlot, deleteSlot, listAds, createAd, updateAd, deleteAd] as const);

export default router;
