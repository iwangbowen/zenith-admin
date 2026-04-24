/**
 * 在线会话路由 —— 使用 `@hono/zod-openapi` 的 `defineOpenAPIRoute` + `openapiRoutes` 模式。
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { getOnlineSessions, forceLogout } from '../lib/session-manager';
import { sendToUser, closeUserConnections } from '../lib/ws-manager';
import { validationHook, commonErrorResponses, PaginationQuery, okPaginated, okBody, errBody } from '../lib/openapi-schemas';
import { OnlineSessionDTO as SessionItemSchema } from '../lib/openapi-dtos';
import { pageOffset } from '../lib/pagination';

const sessionsRoute = new OpenAPIHono({ defaultHook: validationHook });

// ─── Schemas ───────────────────────────────────────────────────────────────
const ForceLogoutResponse = z.object({
  code: z.number(),
  message: z.string(),
  data: z.null(),
});

// ─── Routes ────────────────────────────────────────────────────────────────
const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['Sessions'],
    summary: '获取在线会话列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:session:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
      }),
    },
    responses: {
      ...commonErrorResponses,
      ...okPaginated(SessionItemSchema, '在线会话列表'),
    },
  }),
  handler: async (c) => {
    const q = c.req.valid('query');
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 10;
    const keyword = q.keyword ?? '';

    let sessions = await getOnlineSessions();
    if (keyword) {
      sessions = sessions.filter(
        (s) =>
          s.username.includes(keyword) ||
          s.nickname.includes(keyword) ||
          s.ip.includes(keyword),
      );
    }
    const total = sessions.length;
    const list = sessions.slice(pageOffset(page, pageSize), page * pageSize);

    return c.json(
      okBody({
        list: list.map((s) => ({
          tokenId: s.tokenId,
          userId: s.userId,
          username: s.username,
          nickname: s.nickname,
          ip: s.ip,
          browser: s.browser,
          os: s.os,
          loginAt: s.loginAt.toISOString(),
        })),
        total,
        page,
        pageSize,
      }),
      200,
    );
  },
});

const forceLogoutRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{tokenId}',
    tags: ['Sessions'],
    summary: '强制指定会话下线',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'system:session:forceLogout', audit: { module: '会话管理', description: '强制下线' } }),
    ] as const,
    request: {
      params: z.object({
        tokenId: z.string().openapi({ param: { name: 'tokenId', in: 'path' }, example: 'abc123' }),
      }),
    },
    responses: {
      ...commonErrorResponses,
      200: { content: { 'application/json': { schema: ForceLogoutResponse } }, description: '下线成功' },
      404: { content: { 'application/json': { schema: ForceLogoutResponse } }, description: '会话不存在' },
    },
  }),
  handler: async (c) => {
    const { tokenId } = c.req.valid('param');
    const allSessions = await getOnlineSessions();
    const session = allSessions.find((s) => s.tokenId === tokenId);
    const success = await forceLogout(tokenId);
    if (!success) {
      return c.json(errBody('会话不存在', 404), 404);
    }
    if (session) {
      sendToUser(session.userId, { type: 'session:force-logout', payload: { reason: '您已被管理员强制下线' } });
      setTimeout(() => closeUserConnections(session.userId, '强制下线'), 500);
    }
    return c.json(okBody(null, '已强制下线'), 200);
  },
});

sessionsRoute.openapiRoutes([listRoute, forceLogoutRoute] as const);

export default sessionsRoute;
