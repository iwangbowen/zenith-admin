import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, BatchIdsBody, okBody,
} from '../lib/openapi-schemas';
import { WorkflowAutomationDTO } from '../lib/openapi-dtos';
import {
  createWorkflowAutomationSchema,
  updateWorkflowAutomationSchema,
} from '@zenith/shared';
import {
  listWorkflowAutomations,
  getWorkflowAutomation,
  createWorkflowAutomation,
  updateWorkflowAutomation,
  deleteWorkflowAutomation,
  batchDeleteWorkflowAutomations,
} from '../services/workflow-automations.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listQuery = PaginationQuery.extend({
  definitionId: z.coerce.number().int().optional(),
  trigger: z.enum(['approved', 'rejected', 'withdrawn']).optional(),
  status: z.enum(['enabled', 'disabled']).optional(),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['WorkflowAutomations'], summary: '流程自动化规则分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const,
    request: { query: listQuery },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowAutomationDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listWorkflowAutomations(c.req.valid('query'))), 200),
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['WorkflowAutomations'], summary: '获取自动化规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowAutomationDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getWorkflowAutomation(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['WorkflowAutomations'], summary: '创建自动化规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '创建流程自动化规则', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(createWorkflowAutomationSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowAutomationDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createWorkflowAutomation(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['WorkflowAutomations'], summary: '更新自动化规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '更新流程自动化规则', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateWorkflowAutomationSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowAutomationDTO, '更新成功') },
  }),
  handler: async (c) => c.json(okBody(await updateWorkflowAutomation(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['WorkflowAutomations'], summary: '删除自动化规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '删除流程自动化规则', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    await deleteWorkflowAutomation(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/batch-delete', tags: ['WorkflowAutomations'], summary: '批量删除自动化规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '批量删除流程自动化规则', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const n = await batchDeleteWorkflowAutomations(ids);
    return c.json(okBody(null, `成功删除 ${n} 条`), 200);
  },
});

router.openapiRoutes([listRoute, getRoute, createRouteDef, updateRoute, deleteRoute, batchDeleteRoute] as const);

export default router;
