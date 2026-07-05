// ─── 管理员强制操作与令牌运维（拆分自 workflow-instances.ts 路由）───
import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../../middleware/guard';
import { idempotencyGuard } from '../../../middleware/idempotency';
import { batchSkipStuckTokensSchema, jumpWorkflowInstanceSchema, reassignWorkflowTaskSchema, recallWorkflowTaskSchema, suspendWorkflowInstanceSchema, workflowHandoverSchema } from '@zenith/shared';
import { ErrorResponse, jsonContent, commonErrorResponses, ok, IdParam, okBody } from '../../../lib/openapi-schemas';
import { WorkflowInstanceDTO, WorkflowRecoveryBatchResultDTO, WorkflowTaskDTO, WorkflowHandoverPreviewDTO, WorkflowHandoverResultDTO } from '../../../lib/openapi-dtos';
import { skipStuckToken, replayFromToken, batchSkipStuckTokens, getInstanceForAdminAudit, getWorkflowTaskBeforeAudit, getWorkflowTaskForAdminAudit, jumpInstance, reassignTask, recallTask, suspendInstance, resumeInstance, previewHandover, handoverTasks } from '../../../services/workflow/workflow-instances.service';
import { taskIdParam } from './shared';

export const TokenOpBody = z.object({ reason: z.string().max(255).optional() });

export const tokenSkipRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/tokens/{id}/skip', tags: ['WorkflowInstances'], summary: '跳过卡死的执行 Token',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor', audit: { description: '跳过卡死执行 Token', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(TokenOpBody), required: false } },
    responses: { ...commonErrorResponses, ...ok(WorkflowInstanceDTO, '已跳过'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await skipStuckToken(c.req.valid('param').id, c.req.valid('json')?.reason), '已跳过并推进'), 200),
});

export const tokenReplayRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/tokens/{id}/replay', tags: ['WorkflowInstances'], summary: '从执行 Token 节点重放流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:cancel', audit: { description: '从执行 Token 重放流程', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(TokenOpBody), required: false } },
    responses: { ...commonErrorResponses, ...ok(WorkflowInstanceDTO, '已重放'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await replayFromToken(c.req.valid('param').id, c.req.valid('json')?.reason), '已从该节点重放'), 200),
});

export const batchSkipStuckRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/batch-skip-stuck', tags: ['WorkflowInstances'], summary: '批量推进卡在指定节点的实例',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor', audit: { description: '批量推进卡死实例', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(batchSkipStuckTokensSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowRecoveryBatchResultDTO, '批量恢复结果') },
  }),
  handler: async (c) => {
    const body = c.req.valid('json');
    const res = await batchSkipStuckTokens(body);
    return c.json(okBody(res, `已推进 ${res.success}/${res.total} 个实例`), 200);
  },
});

export const jumpInstanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/jump', tags: ['WorkflowInstances'], summary: '管理员强制跳转节点',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:cancel', audit: { description: '强制跳转流程节点', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(jumpWorkflowInstanceSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已跳转'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { targetNodeKey, comment } = c.req.valid('json');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await jumpInstance(id, targetNodeKey, comment), '已跳转'), 200);
  },
});

export const reassignRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/reassign', tags: ['WorkflowInstances'], summary: '管理员改派处理人',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:cancel', audit: { description: '改派审批处理人', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(reassignWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowTaskDTO, '已改派'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserId, comment } = c.req.valid('json');
    const before = await getWorkflowTaskForAdminAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const row = await reassignTask(taskId, targetUserId, comment);
    const after = await getWorkflowTaskForAdminAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(row, '已改派'), 200);
  },
});

export const recallRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/recall', tags: ['WorkflowInstances'], summary: '撤回已办',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle', audit: { description: '撤回已办', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(recallWorkflowTaskSchema), required: false } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已撤回'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const body = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await recallTask(taskId, body?.comment), '已撤回'), 200);
  },
});

export const suspendInstanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/suspend', tags: ['WorkflowInstances'], summary: '挂起流程实例',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '挂起流程实例', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(suspendWorkflowInstanceSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已挂起'),
      400: { content: jsonContent(ErrorResponse), description: '状态不允许' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await suspendInstance(id, reason), '已挂起，计时已冻结'), 200);
  },
});

export const resumeInstanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/resume', tags: ['WorkflowInstances'], summary: '恢复挂起的流程实例',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '恢复挂起流程实例', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已恢复'),
      400: { content: jsonContent(ErrorResponse), description: '状态不允许' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await resumeInstance(id), '已恢复流转，计时按剩余时长续跑'), 200);
  },
});

export const handoverPreviewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/tasks/handover-preview', tags: ['WorkflowInstances'], summary: '离职交接影响范围预览',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handover' })] as const,
    request: { query: z.object({ fromUserId: z.coerce.number().int().positive() }) },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowHandoverPreviewDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '交接人不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await previewHandover(c.req.valid('query').fromUserId)), 200),
});

export const handoverRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/handover', tags: ['WorkflowInstances'], summary: '离职交接（批量移交待办）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handover', audit: { description: '离职交接待办', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(workflowHandoverSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowHandoverResultDTO, '交接结果'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const body = c.req.valid('json');
    const res = await handoverTasks(body);
    setAuditAfterData(c, { fromUserId: body.fromUserId, toUserId: body.toUserId, ...res, results: undefined });
    return c.json(okBody(res, `已交接 ${res.succeeded}/${res.taskTotal} 条待办`), 200);
  },
});
