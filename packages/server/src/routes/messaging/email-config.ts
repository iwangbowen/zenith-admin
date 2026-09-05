import { OpenAPIHono } from '@hono/zod-openapi';
import { emailConfigContract } from '@zenith/shared/messaging';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getEmailConfig, updateEmailConfig, sendTestEmail, getEmailConfigBeforeAudit } from '../../services/messaging/email-config.service';

const emailConfigRouter = new OpenAPIHono({ defaultHook: validationHook });

const getRoute = defineContractRoute(emailConfigContract.get, {
  middleware: [authMiddleware, guard({ permission: 'system:email-config:view' })],
  handler: async (c) => c.json(okBody(await getEmailConfig(), 'success'), 200),
});

const updateRoute = defineContractRoute(emailConfigContract.save, {
  middleware: [authMiddleware, guard({ permission: 'system:email-config:update', audit: { description: '更新邮件配置', module: '邮件配置' } })],
  handler: async (c) => {
    const before = await getEmailConfigBeforeAudit();
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateEmailConfig(c.req.valid('json')), '保存成功'), 200);
  },
});

const testRoute = defineContractRoute(emailConfigContract.test, {
  middleware: [authMiddleware, guard({
    permission: 'system:email-config:update',
    audit: { description: '发送测试邮件', module: '邮件配置' },
  })],
  handler: async (c) => {
    await sendTestEmail(c.req.valid('json').email);
    return c.json(okBody(null, '测试邮件发送成功'), 200);
  },
});

emailConfigRouter.openapiRoutes([getRoute, updateRoute, testRoute] as const);

export default emailConfigRouter;
