import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { jsonContent, validationHook, commonErrorResponses, ok, okMsg, IdParam, okBody } from '../lib/openapi-schemas';
import { createWorkflowQuickPhraseSchema, updateWorkflowQuickPhraseSchema } from '@zenith/shared';
import { WorkflowQuickPhraseDTO } from '../lib/openapi-dtos';
import {
  listMyQuickPhrases, createMyQuickPhrase, updateMyQuickPhrase, deleteMyQuickPhrase,
} from '../services/workflow-quick-phrases.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['WorkflowQuickPhrases'], summary: '我的审批常用语',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowQuickPhraseDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listMyQuickPhrases()), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['WorkflowQuickPhrases'], summary: '新增常用语',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(createWorkflowQuickPhraseSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowQuickPhraseDTO, '已新增') },
  }),
  handler: async (c) => c.json(okBody(await createMyQuickPhrase(c.req.valid('json')), '已新增'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['WorkflowQuickPhrases'], summary: '更新常用语',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam, body: { content: jsonContent(updateWorkflowQuickPhraseSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowQuickPhraseDTO, '已更新') },
  }),
  handler: async (c) => c.json(okBody(await updateMyQuickPhrase(c.req.valid('param').id, c.req.valid('json')), '已更新'), 200),
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['WorkflowQuickPhrases'], summary: '删除常用语',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已删除') },
  }),
  handler: async (c) => {
    await deleteMyQuickPhrase(c.req.valid('param').id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

router.openapiRoutes([listRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default router;
