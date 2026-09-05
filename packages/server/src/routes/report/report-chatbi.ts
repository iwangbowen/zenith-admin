import { OpenAPIHono } from '@hono/zod-openapi';
import { reportChatbiContract } from '@zenith/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { namedRateLimit } from '../../middleware/rate-limit';
import {
  archiveChatbiSession,
  askChatbi,
  createChatbiSession,
  deleteChatbiSession,
  getChatbiQuotaStats,
  getChatbiSession,
  listChatbiAudit,
  listChatbiSessions,
  saveChatbiMessageAsset,
  updateChatbiSession,
} from '../../services/report/report-chatbi.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(reportChatbiContract.sessions, {
  middleware: [authMiddleware, guard({ permission: 'report:chatbi:list' })],
  handler: async (c) => c.json(okBody(await listChatbiSessions(c.req.valid('query'))), 200),
});

const createRouteDef = defineContractRoute(reportChatbiContract.createSession, {
  middleware: [
    authMiddleware,
    namedRateLimit('report_chatbi_write'),
    guard({ permission: 'report:chatbi:create', audit: { module: '报表 ChatBI', description: '创建 ChatBI 会话' } }),
  ],
  handler: async (c) => c.json(okBody(await createChatbiSession(c.req.valid('json')), '创建成功'), 200),
});

const detailRoute = defineContractRoute(reportChatbiContract.sessionDetail, {
  middleware: [authMiddleware, guard({ permission: 'report:chatbi:list' })],
  handler: async (c) => c.json(okBody(await getChatbiSession(c.req.valid('param').id)), 200),
});

const updateRouteDef = defineContractRoute(reportChatbiContract.updateSession, {
  middleware: [
    authMiddleware,
    namedRateLimit('report_chatbi_write'),
    guard({ permission: 'report:chatbi:update', audit: { module: '报表 ChatBI', description: '更新 ChatBI 会话' } }),
  ],
  handler: async (c) => c.json(okBody(
    await updateChatbiSession(c.req.valid('param').id, c.req.valid('json')),
    '更新成功',
  ), 200),
});

const archiveRoute = defineContractRoute(reportChatbiContract.archiveSession, {
  middleware: [
    authMiddleware,
    namedRateLimit('report_chatbi_write'),
    guard({ permission: 'report:chatbi:update', audit: { module: '报表 ChatBI', description: '归档 ChatBI 会话' } }),
  ],
  handler: async (c) => c.json(okBody(await archiveChatbiSession(c.req.valid('param').id), '归档成功'), 200),
});

const deleteRouteDef = defineContractRoute(reportChatbiContract.removeSession, {
  middleware: [
    authMiddleware,
    namedRateLimit('report_chatbi_write'),
    guard({ permission: 'report:chatbi:delete', audit: { module: '报表 ChatBI', description: '删除 ChatBI 会话' } }),
  ],
  handler: async (c) => {
    await deleteChatbiSession(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const askRoute = defineContractRoute(reportChatbiContract.ask, {
  middleware: [
    authMiddleware,
    namedRateLimit('chatbi_ask'),
    guard({
      permission: 'report:chatbi:ask',
      audit: { module: '报表 ChatBI', description: '执行 ChatBI 提问', recordResponseBody: false },
    }),
  ],
  handler: async (c) => c.json(okBody(await askChatbi(
    c.req.valid('param').id,
    c.req.valid('json'),
    c.req.raw.signal,
  )), 200),
});

const saveRoute = defineContractRoute(reportChatbiContract.saveMessage, {
  middleware: [
    authMiddleware,
    namedRateLimit('report_chatbi_write'),
    guard({ permission: 'report:chatbi:save', audit: { module: '报表 ChatBI', description: '保存 ChatBI 资源' } }),
  ],
  handler: async (c) => c.json(okBody(
    await saveChatbiMessageAsset(c.req.valid('param').id, c.req.valid('json')),
    '保存成功',
  ), 200),
});

const quotaRoute = defineContractRoute(reportChatbiContract.myQuota, {
  middleware: [authMiddleware, guard({ permission: 'report:chatbi:list' })],
  handler: async (c) => c.json(okBody(await getChatbiQuotaStats()), 200),
});

const auditRoute = defineContractRoute(reportChatbiContract.audit, {
  middleware: [authMiddleware, guard({ permission: 'report:chatbi:audit' })],
  handler: async (c) => c.json(okBody(await listChatbiAudit(c.req.valid('query'))), 200),
});

router.openapiRoutes([
  listRoute,
  createRouteDef,
  detailRoute,
  updateRouteDef,
  archiveRoute,
  deleteRouteDef,
  askRoute,
  saveRoute,
  quotaRoute,
  auditRoute,
] as const);

export default router;
