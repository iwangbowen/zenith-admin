import { OpenAPIHono } from '@hono/zod-openapi';
import { terminalSessionContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listTerminalSessions,
  terminateTerminalSession,
  getTerminalSessionSnapshot,
} from '../../services/ops/terminal-sessions.service';

/**
 * 终端会话监控路由（管理员）
 *
 * 权限：`system:terminal:monitor`。提供活动会话列表与强制终止；
 * 实时旁观 / 接管走 WebSocket（/api/ws/terminal-monitor）。
 */
const router = new OpenAPIHono({ defaultHook: validationHook });
const PERM = 'system:terminal:monitor';

const listRoute = defineContractRoute(terminalSessionContract.list, {
  middleware: [authMiddleware, guard({ permission: PERM })],
  handler: (c) => {
    const { page, pageSize, keyword, kind } = c.req.valid('query');
    return c.json(okBody(listTerminalSessions({ page, pageSize, keyword, kind })), 200);
  },
});

const terminateRoute = defineContractRoute(terminalSessionContract.terminate, {
  middleware: [authMiddleware, guard({ permission: PERM, audit: { description: '强制终止终端会话', module: 'Web 终端' } })],
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
