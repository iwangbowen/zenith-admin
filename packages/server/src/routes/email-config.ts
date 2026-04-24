import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { jsonContent, validationHook, commonErrorResponses, ok, okMsg, okBody } from '../lib/openapi-schemas';
import { EmailConfigDTO } from '../lib/openapi-dtos';
import { emailConfigSchema } from '@zenith/shared';
import { getEmailConfig, updateEmailConfig, sendTestEmail } from '../services/email-config.service';

const emailConfigRouter = new OpenAPIHono({ defaultHook: validationHook });

const TestEmailBody = z.object({ email: z.string() });

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['EmailConfig'], summary: '获取邮件配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:email-config:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(EmailConfigDTO, '邮件配置') },
  }),
  handler: async (c) => c.json(okBody(await getEmailConfig(), 'success'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/', tags: ['EmailConfig'], summary: '更新邮件配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:email-config:update', audit: { description: '更新邮件配置', module: '邮件配置' } })] as const,
    request: { body: { content: jsonContent(emailConfigSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(EmailConfigDTO, '保存成功') },
  }),
  handler: async (c) => c.json(okBody(await updateEmailConfig(c.req.valid('json')), '保存成功'), 200),
});

const testRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/test', tags: ['EmailConfig'], summary: '发送测试邮件',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:email-config:update' })] as const,
    request: { body: { content: jsonContent(TestEmailBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('发送成功') },
  }),
  handler: async (c) => {
    await sendTestEmail(c.req.valid('json').email);
    return c.json(okBody(null, '测试邮件发送成功'), 200);
  },
});

emailConfigRouter.openapiRoutes([getRoute, updateRoute, testRoute] as const);

export default emailConfigRouter;
