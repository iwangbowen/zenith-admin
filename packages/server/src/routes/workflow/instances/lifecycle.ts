// ─── 实例生命周期：创建/撤回/取消/删除/草稿/重新提交（拆分自 workflow-instances.ts 路由）───
import { createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../../../middleware/auth';
import { guard, setAuditBeforeData } from '../../../middleware/guard';
import { idempotencyGuard } from '../../../middleware/idempotency';
import { createWorkflowInstanceWithDraftSchema, submitWorkflowDraftSchema, updateWorkflowInstanceSchema } from '@zenith/shared';
import { ErrorResponse, jsonContent, commonErrorResponses, ok, okMsg, IdParam, okBody } from '../../../lib/openapi-schemas';
import { WorkflowInstanceDTO } from '../../../lib/openapi-dtos';
import { createInstance, withdrawInstance, cancelInstance, deleteInstance, getInstanceForAdminAudit, getWorkflowInstanceBeforeAudit, updateInstanceDraft, submitDraftInstance, resubmitInstance } from '../../../services/workflow/workflow-instances.service';

export const createInstanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances', tags: ['WorkflowInstances'], summary: '发起流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, idempotencyGuard({ ttlSeconds: 10 }), guard({ permission: 'workflow:instance:create', audit: { description: '发起流程申请', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(createWorkflowInstanceWithDraftSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '申请已提交'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '流程定义不存在' },
    },
  }),
  handler: async (c) => {
    const body = c.req.valid('json');
    const r = await createInstance(body);
    return c.json(okBody(r, body.asDraft ? '草稿已保存' : '申请已提交'), 200);
  },
});

export const withdrawRoute = defineOpenAPIRoute({
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

export const cancelInstanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/cancel', tags: ['WorkflowInstances'], summary: '取消流程（管理员强制终止）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:cancel', audit: { description: '取消流程', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已取消'),
      400: { content: jsonContent(ErrorResponse), description: '不能取消' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await cancelInstance(id);
    return c.json(okBody(r, '已取消'), 200);
  },
});

export const deleteInstanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/instances/{id}', tags: ['WorkflowInstances'], summary: '删除流程实例',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:delete', audit: { description: '删除流程实例', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('已删除'),
      400: { content: jsonContent(ErrorResponse), description: '不能删除' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getInstanceForAdminAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteInstance(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

export const updateDraftRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/instances/{id}/draft', tags: ['WorkflowInstances'], summary: '编辑草稿',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '编辑流程草稿', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateWorkflowInstanceSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '草稿已保存'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateInstanceDraft(id, c.req.valid('json')), '草稿已保存'), 200);
  },
});

export const submitDraftRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/submit', tags: ['WorkflowInstances'], summary: '提交草稿',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '提交流程草稿', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(submitWorkflowDraftSchema), required: false } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '申请已提交'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json') ?? {};
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await submitDraftInstance(id, body), '申请已提交'), 200);
  },
});

export const resubmitRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/instances/{id}/resubmit', tags: ['WorkflowInstances'], summary: '重新提交（克隆为草稿）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create', audit: { description: '重新提交流程', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowInstanceDTO, '已生成草稿'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      403: { content: jsonContent(ErrorResponse), description: '无权操作' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowInstanceBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await resubmitInstance(id), '已生成草稿'), 200);
  },
});
