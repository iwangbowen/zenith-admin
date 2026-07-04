// ─── 评论与征询（拆分自 workflow-instances.ts 路由）───
import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../../middleware/guard';
import { createWorkflowCommentSchema, createWorkflowConsultSchema, replyWorkflowConsultSchema } from '@zenith/shared';
import { ErrorResponse, PaginationQuery, jsonContent, commonErrorResponses, ok, okPaginated, IdParam, okBody } from '../../../lib/openapi-schemas';
import { WorkflowCommentDTO, WorkflowTaskConsultDTO } from '../../../lib/openapi-dtos';
import { getWorkflowInstanceBeforeAudit, getWorkflowTaskBeforeAudit } from '../../../services/workflow/workflow-instances.service';
import { listInstanceComments, addInstanceComment } from '../../../services/workflow/workflow-comments.service';
import { createConsult, replyConsult, listMyConsults, getConsultInstanceIdForAudit } from '../../../services/workflow/workflow-consults.service';
import { taskIdParam } from './shared';

export const listCommentsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/{id}/comments', tags: ['WorkflowInstances'], summary: '流程评论列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowCommentDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listInstanceComments(c.req.valid('param').id)), 200),
});

export const addCommentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/comments', tags: ['WorkflowInstances'], summary: '发表流程评论',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list', audit: { description: '发表流程评论', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(createWorkflowCommentSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowCommentDTO, '已评论'),
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await addInstanceComment(c.req.valid('param').id, c.req.valid('json')), '已评论'), 200),
});

export const consultRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/consult', tags: ['WorkflowInstances'], summary: '发起协办',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle', audit: { description: '发起协办', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(createWorkflowConsultSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(WorkflowTaskConsultDTO), '已发起协办'),
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const before = await getWorkflowTaskBeforeAudit(taskId);
    if (before) setAuditBeforeData(c, before);
    const result = await createConsult(taskId, c.req.valid('json'));
    const after = await getWorkflowTaskBeforeAudit(taskId);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(result, '已发起协办'), 200);
  },
});

export const myConsultsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/consults/mine', tags: ['WorkflowInstances'], summary: '我的协办列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle' })] as const,
    request: { query: PaginationQuery.extend({ status: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowTaskConsultDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyConsults(c.req.valid('query'))), 200),
});

export const replyConsultRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/consults/{id}/reply', tags: ['WorkflowInstances'], summary: '回复协办意见',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:task:handle', audit: { description: '回复协办意见', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(replyWorkflowConsultSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowTaskConsultDTO, '已回复'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const instanceId = await getConsultInstanceIdForAudit(id);
    const before = instanceId ? await getWorkflowInstanceBeforeAudit(instanceId) : null;
    if (before) setAuditBeforeData(c, before);
    const result = await replyConsult(id, c.req.valid('json'));
    const after = instanceId ? await getWorkflowInstanceBeforeAudit(instanceId) : null;
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(result, '已回复'), 200);
  },
});
