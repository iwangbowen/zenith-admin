import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { commonErrorResponses, ok, okPaginated, okBody, validationHook, PaginationQuery, IdParam, jsonContent, BatchIdsBody } from '../lib/openapi-schemas';
import { WorkflowEngineActionResultDTO, WorkflowEngineHealthHistoryDTO, WorkflowEngineIntrospectionDTO, WorkflowJobDTO, WorkflowJobDetailDTO, WorkflowJobListQuery, WorkflowJobRetryBody, WorkflowJobSummaryItemDTO, WorkflowJobBatchResultDTO } from '../lib/openapi-dtos';
import { getWorkflowEngineIntrospection } from '../services/workflow-engine-introspection.service';
import { getWorkflowEngineHealthHistory, runWorkflowEngineAction } from '../services/workflow-engine-ops.service';
import { listWorkflowJobs, getWorkflowJobDetail, retryWorkflowJob, skipWorkflowJob, getWorkflowJobsSummary, batchRetryWorkflowJobs, batchSkipWorkflowJobs } from '../services/workflow-jobs.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const ACTION_KEYS = ['replay-outbox', 'recover-delays', 'recover-subprocess', 'process-timeouts', 'recover-triggers'] as const;

const introspectionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/introspection',
    tags: ['WorkflowEngine'],
    summary: '流程引擎内部状态内省',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: {
      query: z.object({
        thresholdMinutes: z.coerce.number().int().min(1).max(24 * 60).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(WorkflowEngineIntrospectionDTO, '流程引擎内部状态快照') },
  }),
  handler: async (c) => {
    const { thresholdMinutes } = c.req.valid('query');
    return c.json(okBody(await getWorkflowEngineIntrospection(thresholdMinutes ?? 30)), 200);
  },
});

const healthHistoryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/health-history',
    tags: ['WorkflowEngine'],
    summary: '流程引擎健康趋势历史',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: {
      query: z.object({
        hours: z.coerce.number().int().min(1).max(24 * 30).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(WorkflowEngineHealthHistoryDTO, '流程引擎健康趋势历史') },
  }),
  handler: async (c) => {
    const { hours } = c.req.valid('query');
    return c.json(okBody(await getWorkflowEngineHealthHistory(hours ?? 24)), 200);
  },
});

const actionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/actions/{action}',
    tags: ['WorkflowEngine'],
    summary: '执行流程引擎运维恢复动作',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { module: '流程引擎', description: '执行引擎运维恢复动作' } })] as const,
    request: {
      params: z.object({
        action: z.enum(ACTION_KEYS),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(WorkflowEngineActionResultDTO, '动作执行结果') },
  }),
  handler: async (c) => {
    const { action } = c.req.valid('param');
    return c.json(okBody(await runWorkflowEngineAction(action)), 200);
  },
});

const jobsListRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/jobs',
    tags: ['WorkflowEngine'],
    summary: '工作流作业账本列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { query: PaginationQuery.merge(WorkflowJobListQuery) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowJobDTO, '作业账本分页列表') },
  }),
  handler: async (c) => {
    const q = c.req.valid('query');
    return c.json(okBody(await listWorkflowJobs(q)), 200);
  },
});

const jobsSummaryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/jobs/summary',
    tags: ['WorkflowEngine'],
    summary: '按作业类型聚合的状态计数',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowJobSummaryItemDTO), '各作业类型的状态计数') },
  }),
  handler: async (c) => {
    return c.json(okBody(await getWorkflowJobsSummary()), 200);
  },
});

const jobDetailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/jobs/{id}',
    tags: ['WorkflowEngine'],
    summary: '工作流作业详情（含执行记录）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowJobDetailDTO, '作业详情') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getWorkflowJobDetail(id)), 200);
  },
});

const jobRetryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/jobs/{id}/retry',
    tags: ['WorkflowEngine'],
    summary: '重试 / 改参重放作业',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { module: '流程引擎', description: '重试工作流作业' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(WorkflowJobRetryBody), required: false } },
    responses: { ...commonErrorResponses, ...ok(WorkflowJobDTO, '已重新入队') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await retryWorkflowJob(id, body?.payload), '已重新入队'), 200);
  },
});

const jobSkipRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/jobs/{id}/skip',
    tags: ['WorkflowEngine'],
    summary: '跳过 / 取消作业',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { module: '流程引擎', description: '跳过工作流作业' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowJobDTO, '已跳过') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await skipWorkflowJob(id), '已跳过'), 200);
  },
});

const jobsBatchRetryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/jobs/batch-retry',
    tags: ['WorkflowEngine'],
    summary: '批量重试作业',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { module: '流程引擎', description: '批量重试工作流作业' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowJobBatchResultDTO, '批量重试结果') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const result = await batchRetryWorkflowJobs(ids);
    return c.json(okBody(result, `已重试 ${result.success} 项${result.skipped > 0 ? `，${result.skipped} 项状态不满足已跳过` : ''}`), 200);
  },
});

const jobsBatchSkipRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/jobs/batch-skip',
    tags: ['WorkflowEngine'],
    summary: '批量跳过作业',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { module: '流程引擎', description: '批量跳过工作流作业' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowJobBatchResultDTO, '批量跳过结果') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const result = await batchSkipWorkflowJobs(ids);
    return c.json(okBody(result, `已跳过 ${result.success} 项${result.skipped > 0 ? `，${result.skipped} 项状态不满足已跳过` : ''}`), 200);
  },
});

router.openapiRoutes([introspectionRoute, healthHistoryRoute, actionRoute, jobsListRoute, jobsSummaryRoute, jobDetailRoute, jobRetryRoute, jobSkipRoute, jobsBatchRetryRoute, jobsBatchSkipRoute] as const);

export default router;
