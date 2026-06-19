import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import {
  validationHook,
  commonErrorResponses,
  okPaginated,
  okMsg,
  okBody,
  PaginationQuery,
} from '../lib/openapi-schemas';
import { TerminalSessionDTO } from '../lib/openapi-dtos';
import {
  listTerminalSessions,
  terminateTerminalSession,
  getTerminalSessionSnapshot,
} from '../services/terminal-sessions.service';

/**
 * 终端会话监控路由（管理员）
 *
 * 权限：`system:terminal:monitor`。提供活动会话列表与强制终止；
 * 实时旁观 / 接管走 WebSocket（/api/ws/terminal-monitor）。
 */
const router = new OpenAPIHono({ defaultHook: validationHook });
const PERM = 'system:terminal:monitor';

const SessionIdParam = z.object({
  sessionId: z.string().min(1).openapi({ param: { name: 'sessionId', in: 'path' }, example: 'tab-1-1700000000000' }),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['TerminalSessions'], summary: '活动终端会话列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        kind: z.enum(['local', 'ssh', 'docker']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(TerminalSessionDTO, '活动会话列表') },
  }),
  handler: (c) => {
    const { page, pageSize, keyword, kind } = c.req.valid('query');
    return c.json(okBody(listTerminalSessions({ page, pageSize, keyword, kind })), 200);
  },
});

const terminateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/:sessionId/terminate', tags: ['TerminalSessions'], summary: '强制终止终端会话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '强制终止终端会话', module: 'Web 终端' } })] as const,
    request: { params: SessionIdParam },
    responses: { ...commonErrorResponses, ...okMsg('已终止') },
  }),
  handler: (c) => {
    const { sessionId } = c.req.valid('param');
    // 终止前记录会话快照，便于审计日志展示被终止的会话信息
    const snapshot = getTerminalSessionSnapshot(sessionId);
    if (snapshot) c.set('auditBeforeData', JSON.stringify(snapshot));
    terminateTerminalSession(sessionId);
    return c.json(okBody(null, '已终止'), 200);
  },
});

router.openapiRoutes([listRoute, terminateRoute] as const);

export default router;
