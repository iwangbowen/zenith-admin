import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody } from '../lib/openapi-schemas';
import { WorkflowDefinitionDTO } from '../lib/openapi-dtos';
import {
  listDefinitions, listPublishedDefinitions, getDefinition, createDefinition,
  updateDefinition, publishDefinition, disableDefinition, deleteDefinition, getWorkflowDefinitionBeforeAudit,
} from '../services/workflow-definitions.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const createWorkflowDefinitionSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).nullable().optional(),
  flowData: z.looseObject({}).nullable().optional(),
  formFields: z.array(z.looseObject({})).nullable().optional(),
  status: z.enum(['draft', 'published', 'disabled']).default('draft'),
});
const updateWorkflowDefinitionSchema = createWorkflowDefinitionSchema.partial();

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['WorkflowDefinitions'], summary: '流程定义列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowDefinitionDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDefinitions(c.req.valid('query'))), 200),
});

const publishedRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/published', tags: ['WorkflowDefinitions'], summary: '已发布列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowDefinitionDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listPublishedDefinitions()), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['WorkflowDefinitions'], summary: '流程定义详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowDefinitionDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getDefinition(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['WorkflowDefinitions'], summary: '创建流程定义',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:create', audit: { description: '创建流程定义', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(createWorkflowDefinitionSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowDefinitionDTO, '创建成功') },
  }),
  handler: async (c) => {
    const r = await createDefinition(c.req.valid('json'));
    return c.json(okBody(r, '创建成功'), 200);
  },
});

const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['WorkflowDefinitions'], summary: '更新流程定义',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '更新流程定义', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateWorkflowDefinitionSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowDefinitionDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await updateDefinition(id, c.req.valid('json'));
    return c.json(okBody(r, '更新成功'), 200);
  },
});

const publishRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/publish', tags: ['WorkflowDefinitions'], summary: '发布流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:publish', audit: { description: '发布流程定义', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowDefinitionDTO, '发布成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await publishDefinition(id);
    return c.json(okBody(r, '发布成功'), 200);
  },
});

const disableRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/disable', tags: ['WorkflowDefinitions'], summary: '禁用流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:publish', audit: { description: '禁用流程定义', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowDefinitionDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await disableDefinition(id);
    return c.json(okBody(r, '禁用成功'), 200);
  },
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['WorkflowDefinitions'], summary: '删除流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:delete', audit: { description: '删除流程定义', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteDefinition(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, publishedRoute, detailRoute, createRouteDef, updateRouteDef, publishRoute, disableRoute, deleteRouteDef] as const);

export default router;
