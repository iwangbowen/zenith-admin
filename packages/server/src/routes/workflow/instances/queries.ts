// ─── 实例查询与看板读模型（列表/详情/分析/逾期）（拆分自 workflow-instances.ts 路由）───
import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../../middleware/auth';
import { guard } from '../../../middleware/guard';
import { ErrorResponse, PaginationQuery, jsonContent, commonErrorResponses, ok, okPaginated, IdParam, okBody } from '../../../lib/openapi-schemas';
import { WorkflowInstanceDTO, WorkflowInstanceListItemDTO, WorkflowInstanceAllDTO, WorkflowAnalyticsDTO, WorkflowOverdueTaskDTO, WorkflowRelationOptionDTO } from '../../../lib/openapi-dtos';
import { listMyInstances, listPendingMine, listAllInstances, listMyCc, listMyHandled, getInstanceDetail, countMyCcUnread, listRelationOptions } from '../../../services/workflow/workflow-instances.service';
import { getWorkflowAnalytics, listOverdueTasks } from '../../../services/workflow/workflow-analytics.service';

export const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances', tags: ['WorkflowInstances'], summary: '我的申请列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { query: PaginationQuery.extend({ status: z.string().optional(), priority: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowInstanceDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyInstances(c.req.valid('query'))), 200),
});

export const pendingMineRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/pending-mine', tags: ['WorkflowInstances'], summary: '待我审批列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), definitionId: z.coerce.number().int().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowInstanceListItemDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listPendingMine(c.req.valid('query'))), 200),
});

export const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/all', tags: ['WorkflowInstances'], summary: '全局流程实例列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { query: PaginationQuery.extend({ status: z.string().optional(), keyword: z.string().optional(), categoryId: z.coerce.number().int().optional(), initiatorKeyword: z.string().optional(), priority: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...ok(WorkflowInstanceAllDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listAllInstances(c.req.valid('query'))), 200),
});

export const ccMineRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/cc-mine', tags: ['WorkflowInstances'], summary: '抄送我的列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowInstanceDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyCc(c.req.valid('query'))), 200),
});

export const handledMineRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/handled-mine', tags: ['WorkflowInstances'], summary: '我已办列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowInstanceDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyHandled(c.req.valid('query'))), 200),
});

export const ccUnreadCountRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/cc-mine/unread-count', tags: ['WorkflowInstances'], summary: '抄送未读数',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.object({ count: z.number().int() }), 'ok') },
  }),
  handler: async (c) => c.json(okBody({ count: await countMyCcUnread() }), 200),
});

export const relationOptionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/relation-options', tags: ['WorkflowInstances'], summary: '关联审批单候选',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { query: z.object({ definitionId: z.coerce.number().int().optional(), keyword: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).optional() }) },
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowRelationOptionDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listRelationOptions(c.req.valid('query'))), 200),
});

export const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/{id}', tags: ['WorkflowInstances'], summary: '实例详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, 'ok'),
      403: { content: jsonContent(ErrorResponse), description: '无权查看' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getInstanceDetail(c.req.valid('param').id)), 200),
});

export const analyticsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/analytics', tags: ['WorkflowInstances'], summary: '流程数据分析',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { query: z.object({ definitionId: z.coerce.number().int().optional() }) },
    responses: { ...commonErrorResponses, ...ok(WorkflowAnalyticsDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getWorkflowAnalytics(c.req.valid('query'))), 200),
});

export const overdueRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/overdue', tags: ['WorkflowInstances'], summary: '超时待办预警列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { query: PaginationQuery.extend({ definitionId: z.coerce.number().int().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowOverdueTaskDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listOverdueTasks(c.req.valid('query'))), 200),
});
