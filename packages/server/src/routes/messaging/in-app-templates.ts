import { OpenAPIHono } from '@hono/zod-openapi';
import { inAppTemplateContract } from '@zenith/shared/messaging';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listInAppTemplates, getInAppTemplate, createInAppTemplate, updateInAppTemplate,
  deleteInAppTemplate, getInAppTemplateBeforeAudit,
} from '../../services/messaging/in-app-templates.service';

const inAppTemplatesRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:in-app-template:list' })] as const;

const listRoute = defineContractRoute(inAppTemplateContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listInAppTemplates(c.req.valid('query'))), 200),
});

const getRoute = defineContractRoute(inAppTemplateContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getInAppTemplate(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(inAppTemplateContract.create, {
  middleware: [authMiddleware, guard({ permission: 'system:in-app-template:create', audit: { description: '创建站内信模板', module: '站内信模板' } })],
  handler: async (c) => c.json(okBody(await createInAppTemplate(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(inAppTemplateContract.update, {
  middleware: [authMiddleware, guard({ permission: 'system:in-app-template:update', audit: { description: '更新站内信模板', module: '站内信模板' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getInAppTemplateBeforeAudit(id));
    return c.json(okBody(await updateInAppTemplate(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(inAppTemplateContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'system:in-app-template:delete', audit: { description: '删除站内信模板', module: '站内信模板' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getInAppTemplateBeforeAudit(id));
    await deleteInAppTemplate(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

inAppTemplatesRouter.openapiRoutes([listRoute, getRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default inAppTemplatesRouter;
