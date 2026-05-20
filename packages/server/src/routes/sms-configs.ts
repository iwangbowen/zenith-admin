import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../lib/openapi-schemas';
import { createSmsConfigSchema, updateSmsConfigSchema, SMS_PROVIDERS } from '@zenith/shared';
import { SmsConfigDTO } from '../lib/openapi-dtos';
import {
  listSmsConfigs, getSmsConfig, createSmsConfig, updateSmsConfig,
  deleteSmsConfig, getSmsConfigBeforeAudit, setSmsConfigDefault,
} from '../services/sms-configs.service';

const smsConfigsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['SmsConfigs'], summary: '短信配置列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:sms-config:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        provider: z.enum(SMS_PROVIDERS).optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(SmsConfigDTO, '短信配置列表') },
  }),
  handler: async (c) => c.json(okBody(await listSmsConfigs(c.req.valid('query'))), 200),
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['SmsConfigs'], summary: '获取短信配置详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:sms-config:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(SmsConfigDTO, '短信配置详情') },
  }),
  handler: async (c) => c.json(okBody(await getSmsConfig(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['SmsConfigs'], summary: '创建短信配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:sms-config:create', audit: { description: '创建短信配置', module: '短信配置' } })] as const,
    request: { body: { content: jsonContent(createSmsConfigSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(SmsConfigDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createSmsConfig(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['SmsConfigs'], summary: '更新短信配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:sms-config:update', audit: { description: '更新短信配置', module: '短信配置' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateSmsConfigSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(SmsConfigDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSmsConfigBeforeAudit(id));
    return c.json(okBody(await updateSmsConfig(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['SmsConfigs'], summary: '删除短信配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:sms-config:delete', audit: { description: '删除短信配置', module: '短信配置' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSmsConfigBeforeAudit(id));
    await deleteSmsConfig(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const setDefaultRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/default', tags: ['SmsConfigs'], summary: '设为默认短信配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:sms-config:default', audit: { description: '设为默认短信配置', module: '短信配置' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(SmsConfigDTO, '操作成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSmsConfigBeforeAudit(id));
    return c.json(okBody(await setSmsConfigDefault(id), '操作成功'), 200);
  },
});

smsConfigsRouter.openapiRoutes([listRoute, getRoute, createRouteDef, updateRoute, setDefaultRoute, deleteRoute] as const);

export default smsConfigsRouter;
