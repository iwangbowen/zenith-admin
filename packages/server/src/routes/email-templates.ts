import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { createEmailTemplateSchema, updateEmailTemplateSchema } from '@zenith/shared';
import { EmailTemplateDTO } from '../lib/openapi-dtos';
import {
  listEmailTemplates, getEmailTemplate, createEmailTemplate, updateEmailTemplate,
  deleteEmailTemplate, getEmailTemplateBeforeAudit,
} from '../services/email-templates.service';

const emailTemplatesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['EmailTemplates'], summary: '邮件模板列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:email-template:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(EmailTemplateDTO, '邮件模板列表') },
  }),
  handler: async (c) => c.json(okBody(await listEmailTemplates(c.req.valid('query'))), 200),
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['EmailTemplates'], summary: '获取邮件模板详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:email-template:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(EmailTemplateDTO, '邮件模板详情') },
  }),
  handler: async (c) => c.json(okBody(await getEmailTemplate(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['EmailTemplates'], summary: '创建邮件模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:email-template:create', audit: { description: '创建邮件模板', module: '邮件模板' } })] as const,
    request: { body: { content: jsonContent(createEmailTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(EmailTemplateDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createEmailTemplate(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['EmailTemplates'], summary: '更新邮件模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:email-template:update', audit: { description: '更新邮件模板', module: '邮件模板' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateEmailTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(EmailTemplateDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getEmailTemplateBeforeAudit(id));
    return c.json(okBody(await updateEmailTemplate(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['EmailTemplates'], summary: '删除邮件模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:email-template:delete', audit: { description: '删除邮件模板', module: '邮件模板' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getEmailTemplateBeforeAudit(id));
    await deleteEmailTemplate(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

emailTemplatesRouter.openapiRoutes([listRoute, getRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default emailTemplatesRouter;
