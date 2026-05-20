import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { createSmsTemplateSchema, updateSmsTemplateSchema, SMS_PROVIDERS } from '@zenith/shared';
import { SmsTemplateDTO } from '../lib/openapi-dtos';
import {
  listSmsTemplates, getSmsTemplate, createSmsTemplate, updateSmsTemplate,
  deleteSmsTemplate, getSmsTemplateBeforeAudit,
} from '../services/sms-templates.service';

const smsTemplatesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['SmsTemplates'], summary: '短信模板列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:sms-template:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        provider: z.enum(SMS_PROVIDERS).optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(SmsTemplateDTO, '短信模板列表') },
  }),
  handler: async (c) => c.json(okBody(await listSmsTemplates(c.req.valid('query'))), 200),
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['SmsTemplates'], summary: '获取短信模板详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:sms-template:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(SmsTemplateDTO, '短信模板详情') },
  }),
  handler: async (c) => c.json(okBody(await getSmsTemplate(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['SmsTemplates'], summary: '创建短信模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:sms-template:create', audit: { description: '创建短信模板', module: '短信模板' } })] as const,
    request: { body: { content: jsonContent(createSmsTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(SmsTemplateDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createSmsTemplate(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['SmsTemplates'], summary: '更新短信模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:sms-template:update', audit: { description: '更新短信模板', module: '短信模板' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateSmsTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(SmsTemplateDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSmsTemplateBeforeAudit(id));
    return c.json(okBody(await updateSmsTemplate(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['SmsTemplates'], summary: '删除短信模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:sms-template:delete', audit: { description: '删除短信模板', module: '短信模板' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSmsTemplateBeforeAudit(id));
    await deleteSmsTemplate(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

smsTemplatesRouter.openapiRoutes([listRoute, getRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default smsTemplatesRouter;
