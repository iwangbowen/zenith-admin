
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { ANALYTICS_SITE_KEY_HEADER } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { optionalAuthMiddleware } from '../../middleware/optional-auth';
import { guard } from '../../middleware/guard';
import { namedRateLimit } from '../../middleware/rate-limit';
import { currentMemberOrNull } from '../../lib/member-context';
import { currentUserOrNull } from '../../lib/context';
import { getCreateTenantId } from '../../lib/tenant';
import { validationHook, commonErrorResponses, IdParam, ok, okBody, okMsg, okPaginated, PaginationQuery } from '../../lib/openapi-schemas';
import {
  AnalyticsExperimentDTO,
  CreateAnalyticsExperimentDTO,
  UpdateAnalyticsExperimentDTO,
  AnalyticsExperimentAssignmentDTO,
  AnalyticsExperimentReportDTO,
} from '../../lib/openapi-dtos';
import { resolveSiteByKey } from '../../services/analytics/analytics-sites.service';
import {
  completeExperiment,
  createExperiment,
  deleteExperiment,
  getAssignments,
  getExperiment,
  getExperimentReport,
  listExperiments,
  pauseExperiment,
  startExperiment,
  updateExperiment,
} from '../../services/analytics/analytics-experiments.service';

const r = new OpenAPIHono({ defaultHook: validationHook });
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/experiments', tags: ['Analytics'], summary: 'A/B 实验列表', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { query: PaginationQuery.extend({ name: z.string().optional(), status: z.enum(['draft', 'running', 'paused', 'completed']).or(z.literal('')).optional() }) },
    responses: { ...okPaginated(AnalyticsExperimentDTO, '实验列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listExperiments(c.req.valid('query'))), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/experiments/{id}', tags: ['Analytics'], summary: 'A/B 实验详情', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { params: IdParam },
    responses: { ...ok(AnalyticsExperimentDTO, '实验详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getExperiment(c.req.valid('param').id)), 200),
});

const createExperimentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/experiments', tags: ['Analytics'], summary: '创建 A/B 实验', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '创建 A/B 实验' } })] as const,
    request: { body: { content: { 'application/json': { schema: CreateAnalyticsExperimentDTO } }, required: true } },
    responses: { ...ok(AnalyticsExperimentDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createExperiment(c.req.valid('json')), '创建成功'), 200),
});

const updateExperimentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/experiments/{id}', tags: ['Analytics'], summary: '更新 A/B 实验', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '更新 A/B 实验' } })] as const,
    request: { params: IdParam, body: { content: { 'application/json': { schema: UpdateAnalyticsExperimentDTO } }, required: true } },
    responses: { ...ok(AnalyticsExperimentDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await updateExperiment(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteExperimentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/experiments/{id}', tags: ['Analytics'], summary: '删除 A/B 实验', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '删除 A/B 实验' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => { await deleteExperiment(c.req.valid('param').id); return c.json(okBody(null, '删除成功'), 200); },
});

function actionRoute(action: 'start' | 'pause' | 'complete', summary: string, fn: (id: number) => Promise<unknown>) {
  return defineOpenAPIRoute({
    route: createRoute({
      method: 'post', path: `/experiments/{id}/${action}`, tags: ['Analytics'], summary, security: [{ BearerAuth: [] }],
      middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: summary } })] as const,
      request: { params: IdParam },
      responses: { ...ok(AnalyticsExperimentDTO, '操作成功'), ...commonErrorResponses },
    }),
    handler: async (c) => {
      const data = await fn(c.req.valid('param').id) as z.infer<typeof AnalyticsExperimentDTO>;
      return c.json(okBody(data, '操作成功'), 200);
    },
  });
}

const reportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/experiments/{id}/report', tags: ['Analytics'], summary: 'A/B 实验报告', security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:view' })] as const,
    request: { params: IdParam, query: z.object({ startDate: dateStr.optional(), endDate: dateStr.optional() }) },
    responses: { ...ok(AnalyticsExperimentReportDTO, '实验报告'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getExperimentReport(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const assignmentsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/experiments/assignments', tags: ['Analytics'], summary: '公开获取 A/B 实验分流结果',
    middleware: [optionalAuthMiddleware, namedRateLimit('analytics-ingest')] as const,
    request: { query: z.object({ keys: z.string().optional(), distinctId: z.string().max(64).optional() }) },
    responses: { ...ok(z.array(AnalyticsExperimentAssignmentDTO), '分流结果'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const user = currentUserOrNull();
    const member = user ? undefined : currentMemberOrNull();
    const site = (!user && !member) ? await resolveSiteByKey(c.req.header(ANALYTICS_SITE_KEY_HEADER) ?? c.req.query('siteKey') ?? null).catch(() => null) : null;
    // 匿名 distinctId 禁止伪造登录态前缀（与 ingest resolveDistinctId 反伪造规则一致）
    const queryDistinctId = c.req.valid('query').distinctId;
    const anonDistinctId = queryDistinctId && !queryDistinctId.startsWith('u:') && !queryDistinctId.startsWith('m:') ? queryDistinctId : undefined;
    const distinctId = user ? `u:${user.userId}` : member ? `m:${member.memberId}` : anonDistinctId;
    if (!distinctId) return c.json(okBody([]), 200);
    const tenantId = user ? getCreateTenantId(user) : member ? (member.tenantId ?? null) : (site?.tenantId ?? null);
    const keys = c.req.valid('query').keys?.split(',').map((key) => key.trim()).filter(Boolean).slice(0, 20);
    return c.json(okBody(await getAssignments(distinctId, tenantId, keys)), 200);
  },
});

r.openapiRoutes([
  assignmentsRoute,
  listRoute,
  detailRoute,
  createExperimentRoute,
  updateExperimentRoute,
  deleteExperimentRoute,
  actionRoute('start', '启动 A/B 实验', startExperiment),
  actionRoute('pause', '暂停 A/B 实验', pauseExperiment),
  actionRoute('complete', '完成 A/B 实验', completeExperiment),
  reportRoute,
] as const);

export default r;
