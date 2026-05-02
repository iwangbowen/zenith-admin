import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { validationHook, commonErrorResponses, PaginationQuery, okPaginated, okBody, okMsg, IdParam } from '../lib/openapi-schemas';
import { OnlineSessionDTO } from '../lib/openapi-dtos';
import { listSessions, forceLogoutSession, forceLogoutAllUserSessions, getSessionBeforeAudit } from '../services/sessions.service';

const sessionsRoute = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['Sessions'], summary: '获取在线会话列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:session:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(OnlineSessionDTO, '在线会话列表') },
  }),
  handler: async (c) => c.json(okBody(await listSessions(c.req.valid('query'))), 200),
});

const forceLogoutRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{tokenId}', tags: ['Sessions'], summary: '强制指定会话下线',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:session:forceLogout', audit: { module: '会话管理', description: '强制下线' } })] as const,
    request: { params: z.object({ tokenId: z.string().openapi({ param: { name: 'tokenId', in: 'path' }, example: 'abc123' }) }) },
    responses: { ...commonErrorResponses, ...okMsg('已强制下线') },
  }),
  handler: async (c) => {
    const { tokenId } = c.req.valid('param');
    const before = await getSessionBeforeAudit(tokenId);
    if (before) setAuditBeforeData(c, before);
    await forceLogoutSession(tokenId);
    return c.json(okBody(null, '已强制下线'), 200);
  },
});

const forceLogoutAllRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/user/{id}', tags: ['Sessions'], summary: '强制指定用户所有会话下线',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:session:forceLogout', audit: { module: '会话管理', description: '强制下线全部会话' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已强制下线全部会话') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await forceLogoutAllUserSessions(id);
    return c.json(okBody(null, '已强制下线全部会话'), 200);
  },
});

sessionsRoute.openapiRoutes([listRoute, forceLogoutAllRouteDef, forceLogoutRouteDef] as const);

export default sessionsRoute;
