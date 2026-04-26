import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { approveWorkflowTaskSchema, rejectWorkflowTaskSchema, createWorkflowInstanceSchema } from '@zenith/shared';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, IdParam, okBody } from '../lib/openapi-schemas';
import { WorkflowInstanceDTO, WorkflowInstanceListItemDTO, WorkflowInstanceAllDTO } from '../lib/openapi-dtos';
import {
  listMyInstances, listPendingMine, listAllInstances, getInstanceDetail,
  createInstance, withdrawInstance, approveTask, rejectTask, getWorkflowInstanceBeforeAudit, getWorkflowTaskBeforeAudit,
} from '../services/workflow-instances.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances', tags: ['WorkflowInstances'], summary: '我的申请列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { query: PaginationQuery.extend({ status: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowInstanceDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyInstances(c.req.valid('query'))), 200),
});

const pendingMineRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/pending-mine', tags: ['WorkflowInstances'], summary: '待我审批列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle' })] as const,
    request: { query: PaginationQuery },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowInstanceListItemDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listPendingMine(c.req.valid('query'))), 200),
});

const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/all', tags: ['WorkflowInstances'], summary: '全局流程实例列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { query: PaginationQuery.extend({ status: z.string().optional(), keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...ok(WorkflowInstanceAllDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listAllInstances(c.req.valid('query'))), 200),
});

const detailRoute = defineOpenAPIRoute({
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

const createInstanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances', tags: ['WorkflowInstances'], summary: '发起流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '发起流程申请', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(createWorkflowInstanceSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '申请已提交'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '流程定义不存在' },
    },
  }),
  handler: async (c) => {
    const r = await createInstance(c.req.valid('json'));
    return c.json(okBody(r, '申请已提交'), 200);
  },
});

const withdrawRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/withdraw', tags: ['WorkflowInstances'], summary: '撤回申请',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '撤回流程申请', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已撤回'),
      400: { content: jsonContent(ErrorResponse), description: '不能撤回' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await withdrawInstance(id);
    return c.json(okBody(r, '已撤回'), 200);
  },
});

const approveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/approve', tags: ['WorkflowInstances'], summary: '审批通过',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle', audit: { description: '审批通过', module: '工作流管理' } })] as const,
    request: {
      params: z.object({ taskId: z.coerce.number().openapi({ param: { name: 'taskId', in: 'path' }, example: 1 }) }),
      body: { content: jsonContent(approveWorkflowTaskSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, 'ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
      500: { content: jsonContent(ErrorResponse), description: '数据异常' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { comment } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const result = await approveTask(taskId, comment);
    return c.json(okBody(result.instance, result.message), 200);
  },
});

const rejectRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/reject', tags: ['WorkflowInstances'], summary: '审批驳回',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle', audit: { description: '审批驳回', module: '工作流管理' } })] as const,
    request: {
      params: z.object({ taskId: z.coerce.number().openapi({ param: { name: 'taskId', in: 'path' }, example: 1 }) }),
      body: { content: jsonContent(rejectWorkflowTaskSchema), required: true },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已驳回'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
      500: { content: jsonContent(ErrorResponse), description: '数据异常' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { comment } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await rejectTask(taskId, comment);
    return c.json(okBody(r, '已驳回'), 200);
  },
});

router.openapiRoutes([listRoute, pendingMineRoute, allRoute, detailRoute, createInstanceRoute, withdrawRoute, approveRoute, rejectRoute] as const);

export default router;
