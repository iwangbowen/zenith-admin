import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { saveWorkflowSimulationCaseSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  commonErrorResponses, ok, okMsg, jsonContent, validationHook, IdParam, okBody, ErrorResponse,
} from '../../lib/openapi-schemas';
import { WorkflowSimulationCaseDTO } from '../../lib/openapi-dtos';
import { listSimulationCases, saveSimulationCase, deleteSimulationCase } from '../../services/workflow/workflow-simulation-cases.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['流程仿真用例'], summary: '按定义列出仿真用例',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const,
    request: { query: z.object({ definitionId: z.coerce.number().int().positive() }) },
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowSimulationCaseDTO), '仿真用例列表') },
  }),
  handler: async (c) => c.json(okBody(await listSimulationCases(c.req.valid('query').definitionId)), 200),
});

const saveRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['流程仿真用例'], summary: '保存仿真用例（同名覆盖）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '保存流程仿真用例', module: '流程仿真' } })] as const,
    request: { body: { content: jsonContent(saveWorkflowSimulationCaseSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowSimulationCaseDTO, '已保存') },
  }),
  handler: async (c) => c.json(okBody(await saveSimulationCase(c.req.valid('json')), '已保存'), 200),
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['流程仿真用例'], summary: '删除仿真用例',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '删除流程仿真用例', module: '流程仿真' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功'), 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  }),
  handler: async (c) => {
    await deleteSimulationCase(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, saveRoute, deleteRoute] as const);

export default router;
