import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsFormContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsForms, createCmsForm, updateCmsForm, deleteCmsForm, ensureCmsFormExists, mapCmsForm,
  listCmsFormSubmissions, deleteCmsFormSubmissions,
} from '../../services/cms/cms-forms.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'cms:form:list' })] as const;

const listRoute = defineContractRoute(cmsFormContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsForms(c.req.valid('query'))), 200),
});

const createRouteDef = defineContractRoute(cmsFormContract.create, {
  middleware: [authMiddleware, guard({ permission: 'cms:form:manage', audit: { description: '创建 CMS 表单', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsForm(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(cmsFormContract.update, {
  middleware: [authMiddleware, guard({ permission: 'cms:form:manage', audit: { description: '更新 CMS 表单', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsForm(await ensureCmsFormExists(id)));
    return c.json(okBody(await updateCmsForm(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(cmsFormContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'cms:form:manage', audit: { description: '删除 CMS 表单', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsForm(await ensureCmsFormExists(id)));
    await deleteCmsForm(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const listSubmissionsRoute = defineContractRoute(cmsFormContract.submissions, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listCmsFormSubmissions(id, page, pageSize)), 200);
  },
});

const deleteSubmissionsRoute = defineContractRoute(cmsFormContract.deleteSubmissions, {
  middleware: [authMiddleware, guard({ permission: 'cms:form:manage', audit: { description: '删除 CMS 表单提交数据', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { ids } = c.req.valid('json');
    await deleteCmsFormSubmissions(id, ids);
    return c.json(okBody(null, `已删除 ${ids.length} 条提交数据`), 200);
  },
});

router.openapiRoutes([listRoute, createRouteDef, updateRouteDef, deleteRouteDef, listSubmissionsRoute, deleteSubmissionsRoute] as const);

export default router;
