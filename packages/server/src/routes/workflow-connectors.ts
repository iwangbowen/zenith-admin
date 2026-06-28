import { OpenAPIHono, createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import { createWorkflowConnectorSchema, updateWorkflowConnectorSchema, testWorkflowConnectorSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { WorkflowConnectorDTO, WorkflowConnectorListQuery, WorkflowConnectorInvokeResultDTO } from '../lib/openapi-dtos';
import {
  listWorkflowConnectors, getWorkflowConnector, createWorkflowConnector,
  updateWorkflowConnector, deleteWorkflowConnector, testWorkflowConnector,
} from '../services/workflow-connectors.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['流程连接器'], summary: '连接器列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:connector:list' })] as const,
    request: { query: PaginationQuery.merge(WorkflowConnectorListQuery) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowConnectorDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listWorkflowConnectors(c.req.valid('query'))), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['流程连接器'], summary: '连接器详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:connector:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowConnectorDTO, '详情'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => c.json(okBody(await getWorkflowConnector(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['流程连接器'], summary: '创建连接器',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:connector:create', audit: { description: '创建流程连接器', module: '流程连接器' } })] as const,
    request: { body: { content: jsonContent(createWorkflowConnectorSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowConnectorDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createWorkflowConnector(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['流程连接器'], summary: '更新连接器',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:connector:update', audit: { description: '更新流程连接器', module: '流程连接器' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateWorkflowConnectorSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowConnectorDTO, '更新成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getWorkflowConnector(id));
    return c.json(okBody(await updateWorkflowConnector(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['流程连接器'], summary: '删除连接器',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:connector:delete', audit: { description: '删除流程连接器', module: '流程连接器' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getWorkflowConnector(id));
    await deleteWorkflowConnector(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const testRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/test',
    tags: ['流程连接器'], summary: '测试连接器调用',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:connector:test', audit: { description: '测试流程连接器', module: '流程连接器' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(testWorkflowConnectorSchema), required: false } },
    responses: { ...commonErrorResponses, ...ok(WorkflowConnectorInvokeResultDTO, '测试结果'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await testWorkflowConnector(id, c.req.valid('json') ?? {})), 200);
  },
});

router.openapiRoutes([listRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_, testRoute] as const);

export default router;
