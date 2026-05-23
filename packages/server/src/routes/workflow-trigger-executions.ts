import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { validationHook, commonErrorResponses, ok, okPaginated, IdParam, PaginationQuery, okBody } from '../lib/openapi-schemas';
import { WorkflowTriggerExecutionDTO } from '../lib/openapi-dtos';
import { listTriggerExecutions, getTriggerExecution } from '../services/workflow-trigger-executions.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const ListQuery = PaginationQuery.extend({
  instanceId: z.coerce.number().int().optional(),
  nodeKey: z.string().optional(),
  status: z.enum(['pending', 'running', 'success', 'failed', 'retrying']).optional(),
});

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['WorkflowTriggerExecutions'], summary: '获取触发器执行记录列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:trigger-execution:view' })] as const,
    request: { query: ListQuery },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowTriggerExecutionDTO, '执行记录列表') },
  }),
  handler: async (c) => c.json(okBody(await listTriggerExecutions(c.req.valid('query'))), 200),
});

const get = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['WorkflowTriggerExecutions'], summary: '获取触发器执行记录详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:trigger-execution:view' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(WorkflowTriggerExecutionDTO, '执行记录详情') },
  }),
  handler: async (c) => c.json(okBody(await getTriggerExecution(c.req.valid('param').id)), 200),
});

router.openapiRoutes([list, get] as const);

export default router;
