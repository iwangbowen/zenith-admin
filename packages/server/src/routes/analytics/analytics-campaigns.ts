import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { validationHook, commonErrorResponses, ok, okMsg, okBody, okPaginated, IdParam, PaginationQuery } from '../../lib/openapi-schemas';
import { AsyncTaskDTO, AnalyticsCampaignDTO, CreateAnalyticsCampaignDTO, UpdateAnalyticsCampaignDTO } from '../../lib/openapi-dtos';
import { listCampaigns, createCampaign, updateCampaign, deleteCampaign, executeCampaign } from '../../services/analytics/analytics-campaigns.service';
import { mapAsyncTask } from '../../lib/task-center';

const r = new OpenAPIHono({ defaultHook: validationHook });

const campaignListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/campaigns',
    tags: ['Analytics'],
    summary: '分群触达活动列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage' })] as const,
    request: { query: PaginationQuery.extend({ segmentId: z.coerce.number().int().positive().optional(), status: z.enum(['draft', 'running', 'completed', 'failed']).optional() }) },
    responses: { ...okPaginated(AnalyticsCampaignDTO, '触达活动列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listCampaigns(c.req.valid('query'))), 200),
});

const campaignCreateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/campaigns',
    tags: ['Analytics'],
    summary: '创建分群触达活动',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '创建分群触达活动' } })] as const,
    request: { body: { content: { 'application/json': { schema: CreateAnalyticsCampaignDTO } }, required: true } },
    responses: { ...ok(AnalyticsCampaignDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createCampaign(c.req.valid('json')), '创建成功'), 200),
});

const campaignUpdateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/campaigns/{id}',
    tags: ['Analytics'],
    summary: '更新分群触达活动',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '更新分群触达活动' } })] as const,
    request: { params: IdParam, body: { content: { 'application/json': { schema: UpdateAnalyticsCampaignDTO } }, required: true } },
    responses: { ...ok(AnalyticsCampaignDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await updateCampaign(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const campaignDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/campaigns/{id}',
    tags: ['Analytics'],
    summary: '删除分群触达活动',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '删除分群触达活动' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    await deleteCampaign(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const campaignExecuteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/campaigns/{id}/execute',
    tags: ['Analytics'],
    summary: '执行分群触达活动',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'analytics:manage', audit: { module: '行为分析', description: '提交分群触达任务' } })] as const,
    request: { params: IdParam },
    responses: { ...ok(AsyncTaskDTO, '任务已提交'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(mapAsyncTask(await executeCampaign(c.req.valid('param').id)), '任务已提交，可在任务中心查看进度'), 200),
});

r.openapiRoutes([
  campaignListRoute,
  campaignCreateRoute,
  campaignUpdateRoute,
  campaignDeleteRoute,
  campaignExecuteRoute,
] as const);

export default r;
