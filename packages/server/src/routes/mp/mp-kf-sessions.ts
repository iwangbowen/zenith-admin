import { OpenAPIHono } from '@hono/zod-openapi';
import { mpKfSessionContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpKfSessions, getMpKfSessionDetail, getMpKfSessionStats,
  acceptMpKfSession, transferMpKfSession, closeMpKfSession, replyMpKfSession,
  getMpKfRoutingConfig, updateMpKfRoutingConfig, rateMpKfSession, getMpKfSessionReport,
  getMpKfRoutingConfigBeforeAudit, getMpKfSessionBeforeAudit,
} from '../../services/mp/mp-kf-session.service';

const mpKfSessionRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'mp:kf:session:list' })] as const;

const listRoute = defineContractRoute(mpKfSessionContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listMpKfSessions(c.req.valid('query'))), 200),
});

const statsRoute = defineContractRoute(mpKfSessionContract.stats, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getMpKfSessionStats(c.req.valid('query').accountId)), 200),
});

const getConfigRoute = defineContractRoute(mpKfSessionContract.config, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getMpKfRoutingConfig(c.req.valid('query').accountId)), 200),
});

const updateConfigRoute = defineContractRoute(mpKfSessionContract.updateConfig, {
  middleware: [authMiddleware, guard({ permission: 'mp:kf:session:config', audit: { description: '保存多客服路由配置', module: '公众号多客服会话' } })],
  handler: async (c) => {
    const { accountId } = c.req.valid('query');
    setAuditBeforeData(c, await getMpKfRoutingConfigBeforeAudit(accountId));
    return c.json(okBody(await updateMpKfRoutingConfig(accountId, c.req.valid('json')), '保存成功'), 200);
  },
});

const detailRoute = defineContractRoute(mpKfSessionContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getMpKfSessionDetail(c.req.valid('param').id)), 200),
});

const acceptRoute = defineContractRoute(mpKfSessionContract.accept, {
  middleware: [authMiddleware, guard({ permission: 'mp:kf:session:accept', audit: { description: '接入会话', module: '公众号多客服会话' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMpKfSessionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await acceptMpKfSession(id, c.req.valid('json')), '接入成功'), 200);
  },
});

const transferRoute = defineContractRoute(mpKfSessionContract.transfer, {
  middleware: [authMiddleware, guard({ permission: 'mp:kf:session:transfer', audit: { description: '转接会话', module: '公众号多客服会话' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMpKfSessionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await transferMpKfSession(id, c.req.valid('json')), '转接成功'), 200);
  },
});

const closeRoute = defineContractRoute(mpKfSessionContract.close, {
  middleware: [authMiddleware, guard({ permission: 'mp:kf:session:close', audit: { description: '结束会话', module: '公众号多客服会话' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMpKfSessionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await closeMpKfSession(id, c.req.valid('json')), '已结束'), 200);
  },
});

const replyRoute = defineContractRoute(mpKfSessionContract.reply, {
  middleware: [authMiddleware, guard({ permission: 'mp:kf:session:reply', audit: { description: '会话回复', module: '公众号多客服会话' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMpKfSessionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await replyMpKfSession(id, c.req.valid('json')), '已发送'), 200);
  },
});

const reportRoute = defineContractRoute(mpKfSessionContract.report, {
  middleware: read,
  handler: async (c) => {
    const q = c.req.valid('query');
    return c.json(okBody(await getMpKfSessionReport(q.accountId, q.days)), 200);
  },
});

const rateRoute = defineContractRoute(mpKfSessionContract.rate, {
  middleware: [authMiddleware, guard({ permission: 'mp:kf:session:close', audit: { description: '会话满意度评分', module: '公众号多客服会话' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    const before = await getMpKfSessionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await rateMpKfSession(id, b.rating, b.remark), '已记录'), 200);
  },
});

mpKfSessionRouter.openapiRoutes([
  listRoute, statsRoute, reportRoute, getConfigRoute, updateConfigRoute, detailRoute,
  acceptRoute, transferRoute, closeRoute, replyRoute, rateRoute,
] as const);

export default mpKfSessionRouter;
