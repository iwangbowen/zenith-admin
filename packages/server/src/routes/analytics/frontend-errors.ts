import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { ANALYTICS_SITE_KEY_HEADER } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { optionalAuthMiddleware } from '../../middleware/optional-auth';
import { guard } from '../../middleware/guard';
import { namedRateLimit } from '../../middleware/rate-limit';
import {
  validationHook, commonErrorResponses, ok, okMsg, okBody, okPaginated, IdParam, PaginationQuery, BatchIdsBody,
} from '../../lib/openapi-schemas';
import {
  ErrorReportInputDTO, ErrorGroupDTO, ErrorGroupDetailDTO, ErrorEventDTO, ErrorOverviewDTO,
  UpdateErrorGroupDTO, ErrorAlertRuleDTO, CreateErrorAlertRuleDTO, UpdateErrorAlertRuleDTO, ErrorAlertLogDTO,
  SourceMapItemDTO, SourceMapUploadDTO,
} from '../../lib/openapi-dtos';
import { getClientIp } from '../../lib/request-helpers';
import {
  reportError, getErrorOverview, listGroups, getGroupDetail, updateGroup, batchUpdateGroupStatus,
  deleteGroups, listErrorEvents, cleanErrors, uploadSourceMap, listSourceMaps, deleteSourceMap,
} from '../../services/analytics/frontend-errors.service';
import { listAlertRules, createAlertRule, updateAlertRule, deleteAlertRule, listAlertLogs, testAlertRule } from '../../services/analytics/error-alert.service';

const r = new OpenAPIHono({ defaultHook: validationHook });


// ─── 上报 ─────────────────────────────────────────────────────────────────────
const reportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['FrontendErrors'], summary: '上报前端错误（匿名/登录均可）',
    middleware: [optionalAuthMiddleware, namedRateLimit('error-report')] as const,
    request: { body: { content: { 'application/json': { schema: ErrorReportInputDTO } }, required: true } },
    responses: { ...okMsg('上报成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    await reportError(c.req.valid('json'), {
      ip: getClientIp(c),
      ua: c.req.header('user-agent') ?? '',
      siteKey: c.req.header(ANALYTICS_SITE_KEY_HEADER) ?? null,
      origin: c.req.header('origin') ?? null,
    });
    return c.json(okBody(null, '上报成功'), 200);
  },
});

// ─── 概览 ─────────────────────────────────────────────────────────────────────
const overviewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/overview', tags: ['FrontendErrors'], summary: '错误概览', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:error:list' })] as const, request: { query: z.object({ days: z.coerce.number().int().min(1).max(365).optional().default(30) }) },
    responses: { ...ok(ErrorOverviewDTO, '概览'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getErrorOverview(c.req.valid('query').days)), 200),
});

// ─── 分组（Issue）列表 / 详情 / 处理 ──────────────────────────────────────────
const groupListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/groups', tags: ['FrontendErrors'], summary: '错误分组列表', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:error:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        status: z.enum(['unresolved', 'resolved', 'ignored', 'muted']).or(z.literal('')).optional(),
        errorType: z.enum(['js_error', 'promise_rejection', 'resource_error', 'console_error', 'http_error', 'white_screen', 'crash']).or(z.literal('')).optional(),
        level: z.enum(['fatal', 'error', 'warning', 'info']).or(z.literal('')).optional(),
        keyword: z.string().optional(),
        assigneeId: z.coerce.number().int().optional(),
      }),
    },
    responses: { ...okPaginated(ErrorGroupDTO, '分组列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listGroups(c.req.valid('query'))), 200),
});

const batchStatusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/groups/batch-status', tags: ['FrontendErrors'], summary: '批量更新分组状态', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:error:manage' })] as const,
    request: {
      query: z.object({ status: z.enum(['unresolved', 'resolved', 'ignored', 'muted']) }),
      body: { content: { 'application/json': { schema: BatchIdsBody } }, required: true },
    },
    responses: { ...okMsg('更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const n = await batchUpdateGroupStatus(c.req.valid('json').ids, c.req.valid('query').status);
    return c.json(okBody(null, `已更新 ${n} 条`), 200);
  },
});

const batchDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/groups/batch', tags: ['FrontendErrors'], summary: '批量删除分组', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:error:manage' })] as const,
    request: { body: { content: { 'application/json': { schema: BatchIdsBody } }, required: true } },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const n = await deleteGroups(c.req.valid('json').ids);
    return c.json(okBody(null, `已删除 ${n} 条`), 200);
  },
});

const groupDetailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/groups/{id}', tags: ['FrontendErrors'], summary: '错误分组详情', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:error:list' })] as const, request: { params: IdParam },
    responses: { ...ok(ErrorGroupDetailDTO, '分组详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getGroupDetail(c.req.valid('param').id)), 200),
});

const groupUpdateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/groups/{id}', tags: ['FrontendErrors'], summary: '处理错误分组', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:error:manage' })] as const,
    request: { params: IdParam, body: { content: { 'application/json': { schema: UpdateErrorGroupDTO } }, required: true } },
    responses: { ...ok(ErrorGroupDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await updateGroup(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

// ─── 错误事件 ─────────────────────────────────────────────────────────────────
const eventListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/events', tags: ['FrontendErrors'], summary: '错误事件列表', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:error:list' })] as const,
    request: { query: PaginationQuery.extend({ groupId: z.coerce.number().int().optional() }) },
    responses: { ...okPaginated(ErrorEventDTO, '事件列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listErrorEvents(c.req.valid('query'))), 200),
});

const cleanRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/clean', tags: ['FrontendErrors'], summary: '清除错误数据', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:error:manage' })] as const, request: { query: z.object({ days: z.coerce.number().int().min(0).default(0) }) },
    responses: { ...okMsg('清除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const n = await cleanErrors(c.req.valid('query').days);
    return c.json(okBody(null, `共清除 ${n} 条记录`), 200);
  },
});

// ─── Source Map ──────────────────────────────────────────────────────────────
const sourceMapListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/source-maps', tags: ['FrontendErrors'], summary: 'Source Map 列表', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:error:manage' })] as const, request: { query: PaginationQuery.extend({ release: z.string().optional() }) },
    responses: { ...okPaginated(SourceMapItemDTO, 'Source Map 列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listSourceMaps(c.req.valid('query'))), 200),
});

const sourceMapUploadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/source-maps', tags: ['FrontendErrors'], summary: '上传 Source Map', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:error:manage' })] as const,
    request: { body: { content: { 'application/json': { schema: SourceMapUploadDTO } }, required: true } },
    responses: { ...ok(SourceMapItemDTO, '上传成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await uploadSourceMap(c.req.valid('json')), '上传成功'), 200),
});

const sourceMapDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/source-maps/{id}', tags: ['FrontendErrors'], summary: '删除 Source Map', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:error:manage' })] as const, request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    await deleteSourceMap(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 告警规则 ─────────────────────────────────────────────────────────────────
const alertListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/alerts', tags: ['FrontendErrors'], summary: '告警规则列表', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:alert:list' })] as const, request: { query: PaginationQuery },
    responses: { ...okPaginated(ErrorAlertRuleDTO, '告警规则'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listAlertRules(c.req.valid('query'))), 200),
});

const alertCreateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/alerts', tags: ['FrontendErrors'], summary: '新增告警规则', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:alert:manage' })] as const,
    request: { body: { content: { 'application/json': { schema: CreateErrorAlertRuleDTO } }, required: true } },
    responses: { ...ok(ErrorAlertRuleDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createAlertRule(c.req.valid('json')), '创建成功'), 200),
});

const alertUpdateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/alerts/{id}', tags: ['FrontendErrors'], summary: '更新告警规则', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:alert:manage' })] as const,
    request: { params: IdParam, body: { content: { 'application/json': { schema: UpdateErrorAlertRuleDTO } }, required: true } },
    responses: { ...ok(ErrorAlertRuleDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await updateAlertRule(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const alertDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/alerts/{id}', tags: ['FrontendErrors'], summary: '删除告警规则', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:alert:manage' })] as const, request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    await deleteAlertRule(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const alertLogListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/alert-logs', tags: ['FrontendErrors'], summary: '告警触发历史', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:alert:list' })] as const,
    request: { query: PaginationQuery.extend({ ruleId: z.coerce.number().int().optional() }) },
    responses: { ...okPaginated(ErrorAlertLogDTO, '告警历史'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listAlertLogs(c.req.valid('query'))), 200),
});

const alertTestRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/alerts/{id}/test', tags: ['FrontendErrors'], summary: '测试发送告警通知', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'monitor:alert:manage' })] as const, request: { params: IdParam },
    responses: { ...okMsg('测试已发送'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    await testAlertRule(c.req.valid('param').id);
    return c.json(okBody(null, '测试消息已发送，请检查各通知渠道'), 200);
  },
});

r.openapiRoutes([
  reportRoute, overviewRoute,
  groupListRoute, batchStatusRoute, batchDeleteRoute, groupDetailRoute, groupUpdateRoute,
  eventListRoute, cleanRoute,
  sourceMapListRoute, sourceMapUploadRoute, sourceMapDeleteRoute,
  alertListRoute, alertCreateRoute, alertUpdateRoute, alertDeleteRoute, alertLogListRoute, alertTestRoute,
] as const);

export default r;
