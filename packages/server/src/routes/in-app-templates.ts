import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { createInAppTemplateSchema, updateInAppTemplateSchema, IN_APP_MESSAGE_TYPES } from '@zenith/shared';
import { InAppTemplateDTO } from '../lib/openapi-dtos';
import {
  listInAppTemplates, getInAppTemplate, createInAppTemplate, updateInAppTemplate,
  deleteInAppTemplate, getInAppTemplateBeforeAudit,
} from '../services/in-app-templates.service';

const inAppTemplatesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['InAppTemplates'], summary: '站内信模板列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:in-app-template:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        type: z.enum(IN_APP_MESSAGE_TYPES).optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(InAppTemplateDTO, '站内信模板列表') },
  }),
  handler: async (c) => c.json(okBody(await listInAppTemplates(c.req.valid('query'))), 200),
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['InAppTemplates'], summary: '获取站内信模板详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:in-app-template:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(InAppTemplateDTO, '站内信模板详情') },
  }),
  handler: async (c) => c.json(okBody(await getInAppTemplate(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['InAppTemplates'], summary: '创建站内信模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:in-app-template:create', audit: { description: '创建站内信模板', module: '站内信模板' } })] as const,
    request: { body: { content: jsonContent(createInAppTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(InAppTemplateDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createInAppTemplate(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['InAppTemplates'], summary: '更新站内信模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:in-app-template:update', audit: { description: '更新站内信模板', module: '站内信模板' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateInAppTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(InAppTemplateDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getInAppTemplateBeforeAudit(id));
    return c.json(okBody(await updateInAppTemplate(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['InAppTemplates'], summary: '删除站内信模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:in-app-template:delete', audit: { description: '删除站内信模板', module: '站内信模板' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getInAppTemplateBeforeAudit(id));
    await deleteInAppTemplate(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

inAppTemplatesRouter.openapiRoutes([listRoute, getRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default inAppTemplatesRouter;
