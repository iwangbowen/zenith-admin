// ─── 抄送与催办（拆分自 workflow-instances.ts 路由）───
import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../../middleware/guard';
import { urgeWorkflowTaskSchema, addInstanceCcSchema, forwardInstanceSchema } from '@zenith/shared';
import { ErrorResponse, jsonContent, commonErrorResponses, ok, okMsg, IdParam, okBody } from '../../../lib/openapi-schemas';
import { WorkflowTaskDTO, WorkflowTaskUrgeDTO } from '../../../lib/openapi-dtos';
import { getWorkflowInstanceBeforeAudit, urgeTask, listTaskUrges, listInstanceUrges, urgeInstance, addInstanceCc, markCcRead, forwardInstance } from '../../../services/workflow/workflow-instances.service';
import { taskIdParam } from './shared';

export const ccReadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/cc/{ccTaskId}/read', tags: ['WorkflowInstances'], summary: '标记抄送已读',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { params: z.object({ ccTaskId: z.coerce.number().int().positive() }) },
    responses: { ...commonErrorResponses, ...okMsg('已标记已读') },
  }),
  handler: async (c) => {
    await markCcRead(c.req.valid('param').ccTaskId);
    return c.json(okBody(null, '已标记已读'), 200);
  },
});

export const forwardRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/forward', tags: ['WorkflowInstances'], summary: '主动抄送 / 转发',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list', audit: { description: '转发抄送', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(forwardInstanceSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已抄送'), 403: { content: jsonContent(ErrorResponse), description: '无权操作' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { userIds, note } = c.req.valid('json');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await forwardInstance(id, userIds, note);
    const after = await getWorkflowInstanceBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, r.message), 200);
  },
});

export const urgeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/tasks/{taskId}/urge', tags: ['WorkflowInstances'], summary: '催办',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '催办任务', module: '工作流管理' } })] as const,
    request: { params: taskIdParam, body: { content: jsonContent(urgeWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowTaskUrgeDTO, '已催办'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
      429: { content: jsonContent(ErrorResponse), description: '催办过于频繁' },
    },
  }),
  handler: async (c) => {
    const { taskId } = c.req.valid('param');
    const { message } = c.req.valid('json');
    const r = await urgeTask(taskId, message);
    return c.json(okBody(r, '已催办'), 200);
  },
});

export const listTaskUrgesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/tasks/{taskId}/urges', tags: ['WorkflowInstances'], summary: '查询任务催办历史',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { params: taskIdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowTaskUrgeDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listTaskUrges(c.req.valid('param').taskId)), 200),
});

export const listInstanceUrgesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/instances/{id}/urges', tags: ['WorkflowInstances'], summary: '查询实例催办历史',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowTaskUrgeDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listInstanceUrges(c.req.valid('param').id)), 200),
});

export const urgeInstanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/urge', tags: ['WorkflowInstances'], summary: '实例批量催办',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '实例批量催办', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(urgeWorkflowTaskSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(WorkflowTaskUrgeDTO), '已催办'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { message } = c.req.valid('json');
    const r = await urgeInstance(id, message);
    return c.json(okBody(r.list, r.message), 200);
  },
});

export const addInstanceCcRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/cc/add', tags: ['WorkflowInstances'], summary: '运行中动态补加抄送',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '动态补加抄送', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(addInstanceCcSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(WorkflowTaskDTO), '已补加抄送'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { nodeKey, userIds } = c.req.valid('json');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await addInstanceCc(id, nodeKey, userIds);
    const after = await getWorkflowInstanceBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(r.list, r.message), 200);
  },
});
