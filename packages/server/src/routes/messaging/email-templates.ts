import { OpenAPIHono } from '@hono/zod-openapi';
import { emailTemplateContract } from '@zenith/shared/messaging';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listEmailTemplates, getEmailTemplate, createEmailTemplate, updateEmailTemplate,
  deleteEmailTemplate, getEmailTemplateBeforeAudit,
} from '../../services/messaging/email-templates.service';

const emailTemplatesRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:email-template:list' })] as const;

const listRoute = defineContractRoute(emailTemplateContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listEmailTemplates(c.req.valid('query'))), 200),
});

const getRoute = defineContractRoute(emailTemplateContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getEmailTemplate(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(emailTemplateContract.create, {
  middleware: [authMiddleware, guard({ permission: 'system:email-template:create', audit: { description: '创建邮件模板', module: '邮件模板' } })],
  handler: async (c) => c.json(okBody(await createEmailTemplate(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(emailTemplateContract.update, {
  middleware: [authMiddleware, guard({ permission: 'system:email-template:update', audit: { description: '更新邮件模板', module: '邮件模板' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getEmailTemplateBeforeAudit(id));
    return c.json(okBody(await updateEmailTemplate(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(emailTemplateContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'system:email-template:delete', audit: { description: '删除邮件模板', module: '邮件模板' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getEmailTemplateBeforeAudit(id));
    await deleteEmailTemplate(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

emailTemplatesRouter.openapiRoutes([listRoute, getRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default emailTemplatesRouter;
