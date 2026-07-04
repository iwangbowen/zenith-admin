// ─── 任务流转：转办/委派/加签/减签/退回（拆分自 workflow-instances.ts 路由）───
import { createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../../middleware/guard';
import { idempotencyGuard } from '../../../middleware/idempotency';
import { transferWorkflowTaskSchema, delegateWorkflowTaskSchema, addSignWorkflowTaskSchema, reduceSignWorkflowTaskSchema, returnWorkflowTaskSchema } from '@zenith/shared';
import { ErrorResponse, jsonContent, commonErrorResponses, ok, okMsg, okBody } from '../../../lib/openapi-schemas';
import { WorkflowInstanceDTO, WorkflowTaskDTO } from '../../../lib/openapi-dtos';
import { getWorkflowTaskBeforeAudit, transferTask, delegateTask, addSignTask, reduceSignTask, returnTask } from '../../../services/workflow/workflow-instances.service';
import { taskIdParam } from './shared';

export const transferRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/transfer', tags: ['WorkflowInstances'], summary: '转办',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '转办任务', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(transferWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowTaskDTO, '已转办'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserId, comment, attachments } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await transferTask(taskId, targetUserId, comment, attachments);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(r, '已转办'), 200);
  },
});

export const delegateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/delegate', tags: ['WorkflowInstances'], summary: '委派',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '委派任务', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(delegateWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowTaskDTO, '已委派'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserId, comment, attachments } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await delegateTask(taskId, targetUserId, comment, attachments);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(r, '已委派'), 200);
  },
});

export const addSignRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/add-sign', tags: ['WorkflowInstances'], summary: '加签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '加签任务', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(addSignWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('已加签'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetUserIds, position, comment, signMode, attachments } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await addSignTask(taskId, targetUserIds, position, comment, signMode, attachments);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, r.message), 200);
  },
});

export const reduceSignRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/reduce-sign', tags: ['WorkflowInstances'], summary: '减签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '减签任务', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(reduceSignWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('已减签'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetTaskIds, comment } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await reduceSignTask(taskId, targetTaskIds, comment);
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, r.message), 200);
  },
});

export const returnRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/return', tags: ['WorkflowInstances'], summary: '退回',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:task:handle', audit: { description: '退回任务', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(returnWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已退回'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { targetNodeKeys, comment, attachments } = c.req.valid('json');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const r = await returnTask(taskId, targetNodeKeys, comment, attachments);
    return c.json(okBody(r.instance, r.message), 200);
  },
});
