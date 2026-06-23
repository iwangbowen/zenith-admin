import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { WorkflowFormDTO } from '../lib/openapi-dtos';
import { createWorkflowFormSchema, updateWorkflowFormSchema } from '@zenith/shared';
import {
  listWorkflowForms,
  listEnabledWorkflowForms,
  getWorkflowForm,
  createWorkflowForm,
  duplicateWorkflowForm,
  updateWorkflowForm,
  deleteWorkflowForm,
} from '../services/workflow-forms.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['WorkflowForms'], summary: '表单分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:form:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: z.enum(['enabled', 'disabled']).optional(), categoryId: z.coerce.number().int().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowFormDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listWorkflowForms(c.req.valid('query'))), 200),
});

const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/enabled', tags: ['WorkflowForms'], summary: '全部启用表单（流程设计选用）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:form:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowFormDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listEnabledWorkflowForms()), 200),
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['WorkflowForms'], summary: '获取表单详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:form:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowFormDTO, 'ok'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await getWorkflowForm(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['WorkflowForms'], summary: '创建表单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:form:create', audit: { description: '创建表单', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(createWorkflowFormSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowFormDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createWorkflowForm(c.req.valid('json')), '创建成功'), 200),
});

const duplicateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/duplicate', tags: ['WorkflowForms'], summary: '复制表单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:form:create', audit: { description: '复制表单', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowFormDTO, '复制成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await duplicateWorkflowForm(c.req.valid('param').id), '已复制为新表单'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['WorkflowForms'], summary: '更新表单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:form:edit', audit: { description: '更新表单', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateWorkflowFormSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowFormDTO, '更新成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowForm(id).catch(() => null);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateWorkflowForm(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['WorkflowForms'], summary: '删除表单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:form:delete', audit: { description: '删除表单', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 400: { content: jsonContent(ErrorResponse), description: '参数错误' } },
  }),
  handler: async (c) => {
    await deleteWorkflowForm(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, allRoute, getRoute, createRouteDef, duplicateRoute, updateRoute, deleteRoute] as const);

export default router;
