/**
 * 在线会话路由 —— 使用 `@hono/zod-openapi` 编写的参考实现。
 *
 * 本文件是团队后续批量把手写 openapi.ts 迁移到 `@hono/zod-openapi` 的样板：
 *  1. 用 `OpenAPIHono` 替换 `Hono`；中间件用法一致
 *  2. 用 `createRoute({ method, path, ... })` 集中声明方法/路径/入参/响应
 *  3. 用 `app.openapi(route, handler)` 绑定；Handler 里 `c.req.valid('param'|'json'|'query')`
 *     自动拿到解析好的类型安全值
 *  4. 响应体只需按 Schema 构造一次，无需再单独写 OpenAPI spec
 *
 * 对外行为保持和原实现完全一致，因此可以和手写 openapi.ts 共存。
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { getOnlineSessions, forceLogout } from '../lib/session-manager';
import { sendToUser, closeUserConnections } from '../lib/ws-manager';
import { validationHook, paginatedResponse, jsonContent } from '../lib/openapi-schemas';

const sessionsRoute = new OpenAPIHono({ defaultHook: validationHook });

sessionsRoute.use('/*', authMiddleware);

// ─── Schemas ───────────────────────────────────────────────────────────────
const SessionItemSchema = z.object({
  tokenId: z.string().openapi({ example: 'abc123' }),
  userId: z.number().openapi({ example: 1 }),
  username: z.string().openapi({ example: 'admin' }),
  nickname: z.string().openapi({ example: '管理员' }),
  ip: z.string().openapi({ example: '127.0.0.1' }),
  browser: z.string().openapi({ example: 'Chrome 120' }),
  os: z.string().openapi({ example: 'Windows 11' }),
  loginAt: z.string().openapi({ example: '2026-04-21T10:00:00.000Z' }),
}).openapi('SessionItem');

const SessionListResponse = paginatedResponse(SessionItemSchema);

const ForceLogoutResponse = z.object({
  code: z.number(),
  message: z.string(),
  data: z.null(),
});

// ─── Routes ────────────────────────────────────────────────────────────────
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Sessions'],
  summary: '获取在线会话列表',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:session:list' })] as const,
  request: {
    query: z.object({
      page: z.coerce.number().int().min(1).optional().default(1),
      pageSize: z.coerce.number().int().min(1).max(200).optional().default(10),
      keyword: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: jsonContent(SessionListResponse),
      description: '在线会话列表',
    },
  },
});

sessionsRoute.openapi(listRoute, async (c) => {
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
  const list = sessions.slice((page - 1) * pageSize, page * pageSize);

  return c.json(
    {
      code: 0 as const,
      message: 'ok',
      data: {
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
      },
    },
    200,
  );
});

const forceLogoutRoute = createRoute({
  method: 'delete',
  path: '/{tokenId}',
  tags: ['Sessions'],
  summary: '强制指定会话下线',
  security: [{ BearerAuth: [] }],
  middleware: [
    guard({ permission: 'system:session:forceLogout', audit: { module: '会话管理', description: '强制下线' } }),
  ] as const,
  request: {
    params: z.object({
      tokenId: z.string().openapi({ param: { name: 'tokenId', in: 'path' }, example: 'abc123' }),
    }),
  },
  responses: {
    200: { content: { 'application/json': { schema: ForceLogoutResponse } }, description: '下线成功' },
    404: { content: { 'application/json': { schema: ForceLogoutResponse } }, description: '会话不存在' },
  },
});

sessionsRoute.openapi(forceLogoutRoute, async (c) => {
  const { tokenId } = c.req.valid('param');
  const allSessions = await getOnlineSessions();
  const session = allSessions.find((s) => s.tokenId === tokenId);
  const success = await forceLogout(tokenId);
  if (!success) {
    return c.json({ code: 404, message: '会话不存在', data: null }, 404);
  }
  if (session) {
    sendToUser(session.userId, { type: 'session:force-logout', payload: { reason: '您已被管理员强制下线' } });
    setTimeout(() => closeUserConnections(session.userId, '强制下线'), 500);
  }
  return c.json({ code: 0, message: '已强制下线', data: null }, 200);
});

export default sessionsRoute;
