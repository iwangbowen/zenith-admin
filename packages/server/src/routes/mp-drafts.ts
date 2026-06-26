import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { createMpDraftSchema, updateMpDraftSchema } from '@zenith/shared';
import { MpDraftDTO } from '../lib/openapi-dtos';
import {
  listMpDrafts, getMpDraft, createMpDraft, updateMpDraft, deleteMpDraft, pushMpDraft,
} from '../services/mp-draft.service';

const mpDraftsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['公众号图文'], summary: '图文草稿列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:draft:list' })] as const,
    request: { query: PaginationQuery.extend({ accountId: z.coerce.number().int().positive(), keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(MpDraftDTO, '图文草稿列表') },
  }),
  handler: async (c) => c.json(okBody(await listMpDrafts(c.req.valid('query'))), 200),
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['公众号图文'], summary: '图文草稿详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:draft:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(MpDraftDTO, '图文草稿详情') },
  }),
  handler: async (c) => c.json(okBody(await getMpDraft(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['公众号图文'], summary: '创建图文草稿',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:draft:create', audit: { description: '创建图文草稿', module: '公众号图文' } })] as const,
    request: { body: { content: jsonContent(createMpDraftSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpDraftDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createMpDraft(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['公众号图文'], summary: '更新图文草稿',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:draft:update', audit: { description: '更新图文草稿', module: '公众号图文' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateMpDraftSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpDraftDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpDraft(id));
    return c.json(okBody(await updateMpDraft(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const pushRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/push', tags: ['公众号图文'], summary: '推送到微信草稿箱',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:draft:push', audit: { description: '推送图文草稿', module: '公众号图文' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(MpDraftDTO, '推送成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpDraft(id));
    return c.json(okBody(await pushMpDraft(id), '推送成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['公众号图文'], summary: '删除图文草稿',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:draft:delete', audit: { description: '删除图文草稿', module: '公众号图文' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpDraft(id));
    await deleteMpDraft(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mpDraftsRouter.openapiRoutes([listRoute, getRoute, createRouteDef, updateRoute, pushRoute, deleteRoute] as const);

export default mpDraftsRouter;
