import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { createMpAutoReplySchema, updateMpAutoReplySchema, MP_AUTO_REPLY_TYPES } from '@zenith/shared';
import { MpAutoReplyDTO } from '../lib/openapi-dtos';
import {
  listMpAutoReplies, createMpAutoReply, updateMpAutoReply, deleteMpAutoReply, getMpAutoReplyBeforeAudit,
} from '../services/mp-auto-reply.service';

const mpAutoRepliesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['公众号自动回复'], summary: '自动回复列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:reply:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        accountId: z.coerce.number().int().positive(),
        replyType: z.enum(MP_AUTO_REPLY_TYPES).optional(),
        keyword: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(MpAutoReplyDTO, '自动回复列表') },
  }),
  handler: async (c) => c.json(okBody(await listMpAutoReplies(c.req.valid('query'))), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['公众号自动回复'], summary: '创建自动回复',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:reply:create', audit: { description: '创建自动回复', module: '公众号自动回复' } })] as const,
    request: { body: { content: jsonContent(createMpAutoReplySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpAutoReplyDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createMpAutoReply(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['公众号自动回复'], summary: '更新自动回复',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:reply:update', audit: { description: '更新自动回复', module: '公众号自动回复' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateMpAutoReplySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpAutoReplyDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpAutoReplyBeforeAudit(id));
    return c.json(okBody(await updateMpAutoReply(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['公众号自动回复'], summary: '删除自动回复',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:reply:delete', audit: { description: '删除自动回复', module: '公众号自动回复' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpAutoReplyBeforeAudit(id));
    await deleteMpAutoReply(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mpAutoRepliesRouter.openapiRoutes([listRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default mpAutoRepliesRouter;
