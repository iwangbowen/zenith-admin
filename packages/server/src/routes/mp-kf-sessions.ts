import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, IdParam, okBody,
} from '../lib/openapi-schemas';
import {
  acceptMpKfSessionSchema, transferMpKfSessionSchema, closeMpKfSessionSchema,
  replyMpKfSessionSchema, updateMpKfRoutingConfigSchema, rateMpKfSessionSchema,
} from '@zenith/shared';
import {
  MpKfSessionDTO, MpKfSessionDetailDTO, MpKfRoutingConfigDTO, MpKfSessionStatsDTO, MpKfSessionReportDTO,
} from '../lib/openapi-dtos';
import {
  listMpKfSessions, getMpKfSessionDetail, getMpKfSessionStats,
  acceptMpKfSession, transferMpKfSession, closeMpKfSession, replyMpKfSession,
  getMpKfRoutingConfig, updateMpKfRoutingConfig, rateMpKfSession, getMpKfSessionReport,
  getMpKfRoutingConfigBeforeAudit, getMpKfSessionBeforeAudit,
} from '../services/mp-kf-session.service';

const mpKfSessionRouter = new OpenAPIHono({ defaultHook: validationHook });

const accountIdQuery = z.object({ accountId: z.coerce.number().int().positive() });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['公众号多客服会话'], summary: '会话列表（工作台）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:kf:session:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        accountId: z.coerce.number().int().positive(),
        status: z.enum(['waiting', 'active', 'closed']).optional(),
        kfId: z.coerce.number().int().positive().optional(),
        keyword: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(MpKfSessionDTO, '会话列表') },
  }),
  handler: async (c) => c.json(okBody(await listMpKfSessions(c.req.valid('query'))), 200),
});

const statsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/stats', tags: ['公众号多客服会话'], summary: '会话概览统计',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:kf:session:list' })] as const,
    request: { query: accountIdQuery },
    responses: { ...commonErrorResponses, ...ok(MpKfSessionStatsDTO, '会话概览') },
  }),
  handler: async (c) => c.json(okBody(await getMpKfSessionStats(c.req.valid('query').accountId)), 200),
});

const getConfigRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/config', tags: ['公众号多客服会话'], summary: '获取路由治理配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:kf:session:list' })] as const,
    request: { query: accountIdQuery },
    responses: { ...commonErrorResponses, ...ok(MpKfRoutingConfigDTO, '路由配置') },
  }),
  handler: async (c) => c.json(okBody(await getMpKfRoutingConfig(c.req.valid('query').accountId)), 200),
});

const updateConfigRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/config', tags: ['公众号多客服会话'], summary: '保存路由治理配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:kf:session:config', audit: { description: '保存多客服路由配置', module: '公众号多客服会话' } })] as const,
    request: { query: accountIdQuery, body: { content: jsonContent(updateMpKfRoutingConfigSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpKfRoutingConfigDTO, '保存成功') },
  }),
  handler: async (c) => {
    const { accountId } = c.req.valid('query');
    setAuditBeforeData(c, await getMpKfRoutingConfigBeforeAudit(accountId));
    return c.json(okBody(await updateMpKfRoutingConfig(accountId, c.req.valid('json')), '保存成功'), 200);
  },
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['公众号多客服会话'], summary: '会话详情（含消息与事件时间线）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:kf:session:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(MpKfSessionDetailDTO, '会话详情') },
  }),
  handler: async (c) => c.json(okBody(await getMpKfSessionDetail(c.req.valid('param').id)), 200),
});

const acceptRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/accept', tags: ['公众号多客服会话'], summary: '接入会话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:kf:session:accept', audit: { description: '接入会话', module: '公众号多客服会话' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(acceptMpKfSessionSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpKfSessionDTO, '接入成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMpKfSessionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await acceptMpKfSession(id, c.req.valid('json')), '接入成功'), 200);
  },
});

const transferRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/transfer', tags: ['公众号多客服会话'], summary: '转接会话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:kf:session:transfer', audit: { description: '转接会话', module: '公众号多客服会话' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(transferMpKfSessionSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpKfSessionDTO, '转接成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMpKfSessionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await transferMpKfSession(id, c.req.valid('json')), '转接成功'), 200);
  },
});

const closeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/close', tags: ['公众号多客服会话'], summary: '结束会话',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:kf:session:close', audit: { description: '结束会话', module: '公众号多客服会话' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(closeMpKfSessionSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpKfSessionDTO, '已结束') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMpKfSessionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await closeMpKfSession(id, c.req.valid('json')), '已结束'), 200);
  },
});

const replyRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/reply', tags: ['公众号多客服会话'], summary: '会话内回复粉丝',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:kf:session:reply', audit: { description: '会话回复', module: '公众号多客服会话' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(replyMpKfSessionSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpKfSessionDTO, '已发送') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMpKfSessionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await replyMpKfSession(id, c.req.valid('json')), '已发送'), 200);
  },
});

const reportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/report', tags: ['公众号多客服会话'], summary: '会话数据报表（近 N 天）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:kf:session:list' })] as const,
    request: { query: accountIdQuery.extend({ days: z.coerce.number().int().min(1).max(31).default(7) }) },
    responses: { ...commonErrorResponses, ...ok(z.array(MpKfSessionReportDTO), '会话报表') },
  }),
  handler: async (c) => { const q = c.req.valid('query'); return c.json(okBody(await getMpKfSessionReport(q.accountId, q.days)), 200); },
});

const rateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/rate', tags: ['公众号多客服会话'], summary: '记录会话满意度',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:kf:session:close', audit: { description: '会话满意度评分', module: '公众号多客服会话' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(rateMpKfSessionSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpKfSessionDTO, '已记录') },
  }),
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
