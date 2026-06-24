import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { idempotencyGuard } from '../middleware/idempotency';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { createMpBroadcastSchema, updateMpBroadcastSchema } from '@zenith/shared';
import { MpBroadcastDTO } from '../lib/openapi-dtos';
import {
  listMpBroadcasts, createMpBroadcast, updateMpBroadcast, deleteMpBroadcast, sendMpBroadcast, getMpBroadcastBeforeAudit,
} from '../services/mp-broadcast.service';

const mpBroadcastsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['公众号群发'], summary: '群发列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:broadcast:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        accountId: z.coerce.number().int().positive(),
        status: z.enum(['draft', 'sent', 'failed']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(MpBroadcastDTO, '群发列表') },
  }),
  handler: async (c) => c.json(okBody(await listMpBroadcasts(c.req.valid('query'))), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['公众号群发'], summary: '创建群发草稿',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:broadcast:create', audit: { description: '创建公众号群发', module: '公众号群发' } })] as const,
    request: { body: { content: jsonContent(createMpBroadcastSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpBroadcastDTO, '已创建群发草稿') },
  }),
  handler: async (c) => c.json(okBody(await createMpBroadcast(c.req.valid('json')), '已创建群发草稿'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['公众号群发'], summary: '更新群发草稿',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:broadcast:update', audit: { description: '更新公众号群发', module: '公众号群发' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateMpBroadcastSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpBroadcastDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpBroadcastBeforeAudit(id));
    return c.json(okBody(await updateMpBroadcast(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const sendRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/send', tags: ['公众号群发'], summary: '发送群发',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'mp:broadcast:send', audit: { description: '发送公众号群发', module: '公众号群发' } }),
      idempotencyGuard({ ttlSeconds: 10 }),
    ] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(MpBroadcastDTO, '发送成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpBroadcastBeforeAudit(id));
    return c.json(okBody(await sendMpBroadcast(id), '发送成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['公众号群发'], summary: '删除群发',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:broadcast:delete', audit: { description: '删除公众号群发', module: '公众号群发' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpBroadcastBeforeAudit(id));
    await deleteMpBroadcast(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mpBroadcastsRouter.openapiRoutes([listRoute, createRouteDef, updateRoute, sendRoute, deleteRoute] as const);

export default mpBroadcastsRouter;
