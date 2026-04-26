import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { previewMessageTemplateSchema } from '@zenith/shared';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody } from '../lib/openapi-schemas';
import { MessageTemplateDTO, MessageTemplatePreviewDTO as PreviewResultDTO } from '../lib/openapi-dtos';
import {
  listMessageTemplates,
  getMessageTemplate,
  createMessageTemplate,
  updateMessageTemplate,
  deleteMessageTemplate,
  getMessageTemplateBeforeAudit,
  previewMessageTemplate,
} from '../services/message-templates.service';

const messageTemplatesRouter = new OpenAPIHono({ defaultHook: validationHook });

const createMessageTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(100).regex(/^[a-zA-Z]\w*$/),
  channel: z.enum(['email', 'sms', 'in_app']),
  subject: z.string().max(200).optional(),
  content: z.string().min(1),
  variables: z.string().optional(),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(500).optional(),
});
const updateMessageTemplateSchema = createMessageTemplateSchema.partial();

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['MessageTemplates'], summary: '模板分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:message-template:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        channel: z.enum(['email', 'sms', 'in_app']).optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(MessageTemplateDTO, '模板列表') },
  }),
  handler: async (c) => c.json(okBody(await listMessageTemplates(c.req.valid('query'))), 200),
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['MessageTemplates'], summary: '获取单个模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:message-template:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(MessageTemplateDTO, '模板详情') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getMessageTemplate(id)), 200);
  },
});

const createTemplateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['MessageTemplates'], summary: '新增模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:message-template:create', audit: { description: '创建消息模板', module: '消息模板' } })] as const,
    request: { body: { content: jsonContent(createMessageTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MessageTemplateDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createMessageTemplate(c.req.valid('json')), '创建成功'), 200),
});

const updateTemplateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['MessageTemplates'], summary: '更新模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:message-template:update', audit: { description: '更新消息模板', module: '消息模板' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateMessageTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MessageTemplateDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMessageTemplateBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateMessageTemplate(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['MessageTemplates'], summary: '删除模板',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:message-template:delete', audit: { description: '删除消息模板', module: '消息模板' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMessageTemplateBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteMessageTemplate(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const previewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/preview', tags: ['MessageTemplates'], summary: '变量插值预览',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:message-template:list' })] as const,
    request: { params: IdParam, body: { content: jsonContent(previewMessageTemplateSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(PreviewResultDTO, '预览结果') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { variables } = c.req.valid('json');
    return c.json(okBody(await previewMessageTemplate(id, variables)), 200);
  },
});

messageTemplatesRouter.openapiRoutes([listRoute, getRoute, createTemplateRoute, updateTemplateRoute, deleteRoute, previewRoute] as const);

export default messageTemplatesRouter;
