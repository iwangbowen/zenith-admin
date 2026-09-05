import { OpenAPIHono } from '@hono/zod-openapi';
import { smsTemplateContract } from '@zenith/shared/messaging';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listSmsTemplates, getSmsTemplate, createSmsTemplate, updateSmsTemplate,
  deleteSmsTemplate, getSmsTemplateBeforeAudit,
} from '../../services/messaging/sms-templates.service';

const smsTemplatesRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:sms-template:list' })] as const;

const listRoute = defineContractRoute(smsTemplateContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listSmsTemplates(c.req.valid('query'))), 200),
});

const getRoute = defineContractRoute(smsTemplateContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getSmsTemplate(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(smsTemplateContract.create, {
  middleware: [authMiddleware, guard({ permission: 'system:sms-template:create', audit: { description: '创建短信模板', module: '短信模板' } })],
  handler: async (c) => c.json(okBody(await createSmsTemplate(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(smsTemplateContract.update, {
  middleware: [authMiddleware, guard({ permission: 'system:sms-template:update', audit: { description: '更新短信模板', module: '短信模板' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSmsTemplateBeforeAudit(id));
    return c.json(okBody(await updateSmsTemplate(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(smsTemplateContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'system:sms-template:delete', audit: { description: '删除短信模板', module: '短信模板' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getSmsTemplateBeforeAudit(id));
    await deleteSmsTemplate(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

smsTemplatesRouter.openapiRoutes([listRoute, getRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default smsTemplatesRouter;
