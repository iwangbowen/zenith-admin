// ─── 管理员强制操作与令牌运维（拆分自 workflow-instances.ts 路由）───
import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../../middleware/guard';
import { batchSkipStuckTokensSchema, jumpWorkflowInstanceSchema, reassignWorkflowTaskSchema, recallWorkflowTaskSchema } from '@zenith/shared';
import { ErrorResponse, jsonContent, commonErrorResponses, ok, IdParam, okBody } from '../../../lib/openapi-schemas';
import { WorkflowInstanceDTO, WorkflowRecoveryBatchResultDTO, WorkflowTaskDTO } from '../../../lib/openapi-dtos';
import { skipStuckToken, replayFromToken, batchSkipStuckTokens, getInstanceForAdminAudit, getWorkflowTaskBeforeAudit, getWorkflowTaskForAdminAudit, jumpInstance, reassignTask, recallTask } from '../../../services/workflow/workflow-instances.service';
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
