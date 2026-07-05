// ─── 审批动作：同意/拒绝/下一步审批人（拆分自 workflow-instances.ts 路由）───
import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../../middleware/auth';
import { guard, setAuditBeforeData } from '../../../middleware/guard';
import { idempotencyGuard } from '../../../middleware/idempotency';
import { approveWorkflowTaskSchema, rejectWorkflowTaskSchema } from '@zenith/shared';
import { ErrorResponse, jsonContent, commonErrorResponses, ok, okBody } from '../../../lib/openapi-schemas';
import { WorkflowInstanceDTO, WorkflowSelectableNextApproverGroupDTO } from '../../../lib/openapi-dtos';
import { approveTask, rejectTask, getWorkflowTaskBeforeAudit, listTaskSelectableNextApprovers } from '../../../services/workflow/workflow-instances.service';

export const approveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/approve', tags: ['WorkflowInstances'], summary: '审批通过',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '审批通过', module: '工作流管理' } })] as const,
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
    const { comment, attachments, selectedNextApprovers, signature, formUpdates } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const result = await approveTask(taskId, comment, attachments, selectedNextApprovers, signature, formUpdates);
    return c.json(okBody(result.instance, result.message), 200);
  },
});

export const selectableNextApproversRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/tasks/{taskId}/selectable-next-approvers', tags: ['WorkflowInstances'], summary: '下一节点自选审批人候选',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle' })] as const,
    request: { params: z.object({ taskId: z.coerce.number().openapi({ param: { name: 'taskId', in: 'path' }, example: 1 }) }) },
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(WorkflowSelectableNextApproverGroupDTO), 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    return c.json(okBody(await listTaskSelectableNextApprovers(taskId)), 200);
  },
});

export const rejectRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/reject', tags: ['WorkflowInstances'], summary: '审批驳回',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '审批驳回', module: '工作流管理' } })] as const,
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
    const { comment, attachments } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await rejectTask(taskId, comment, attachments);
    return c.json(okBody(r.instance, r.message), 200);
  },
});
