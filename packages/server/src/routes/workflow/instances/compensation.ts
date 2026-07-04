// ─── 补偿中心（拆分自 workflow-instances.ts 路由）───
import { createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../../middleware/auth';
import { guard } from '../../../middleware/guard';
import { PaginationQuery, jsonContent, commonErrorResponses, ok, okPaginated, IdParam, okBody } from '../../../lib/openapi-schemas';
import { resumeInstanceForCompensation } from '../../../services/workflow/workflow-instances.service';
import { listCompensations, resolveCompensation, getCompensationDetail, addCompensationNote, retryCompensationAction } from '../../../services/workflow/workflow-compensations.service';
import { WorkflowCompensationDTO, WorkflowCompensationDetailDTO } from '../../../lib/openapi-dtos';

export const compensationsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/compensation/list', tags: ['WorkflowInstances'], summary: '补偿/修复工单列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { query: PaginationQuery.extend({ status: z.string().optional(), instanceId: z.coerce.number().int().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowCompensationDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listCompensations(c.req.valid('query'))), 200),
});

export const compensationResolveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/compensation/{id}/resolve', tags: ['WorkflowInstances'], summary: '处理补偿工单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '处理补偿工单', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(z.object({ action: z.enum(['resolve', 'terminate']), resolution: z.string().optional() })), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowCompensationDTO, '已处理') },
  }),
  handler: async (c) => { const { id } = c.req.valid('param'); const b = c.req.valid('json'); return c.json(okBody(await resolveCompensation(id, b.action, b.resolution), '已处理'), 200); },
});

export const compensationDetailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/compensation/{id}', tags: ['WorkflowInstances'], summary: '补偿工单详情（含处理历史）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowCompensationDetailDTO, 'ok') },
  }),
  handler: async (c) => { const { id } = c.req.valid('param'); return c.json(okBody(await getCompensationDetail(id)), 200); },
});

export const compensationNoteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/compensation/{id}/note', tags: ['WorkflowInstances'], summary: '补偿工单：添加处理备注/附件',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '补偿工单添加备注', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(z.object({ note: z.string().max(4000).optional(), attachments: z.array(z.object({ id: z.number().int(), name: z.string(), url: z.string() })).optional() })), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowCompensationDetailDTO, '已记录') },
  }),
  handler: async (c) => { const { id } = c.req.valid('param'); const b = c.req.valid('json'); return c.json(okBody(await addCompensationNote(id, b.note, b.attachments), '已记录'), 200); },
});

export const compensationRetryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/compensation/{id}/retry', tags: ['WorkflowInstances'], summary: '补偿工单：重试自动反向动作',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '重试补偿动作', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowCompensationDetailDTO, '已重试') },
  }),
  handler: async (c) => { const { id } = c.req.valid('param'); return c.json(okBody(await retryCompensationAction(id), '已重新入队'), 200); },
});

export const compensationResumeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/compensation/{id}/resume', tags: ['WorkflowInstances'], summary: '补偿工单：恢复后继续推进',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { description: '恢复流程推进', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowCompensationDetailDTO, '已恢复') },
  }),
  handler: async (c) => { const { id } = c.req.valid('param'); await resumeInstanceForCompensation(id); return c.json(okBody(await getCompensationDetail(id), '已恢复推进'), 200); },
});
