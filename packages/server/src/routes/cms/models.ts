import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsModelContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listCmsModels, listAllCmsModels, getCmsModel, createCmsModel, updateCmsModel, deleteCmsModel,
  getCmsModelRefs,
} from '../../services/cms/cms-models.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'cms:model:list' })] as const;

const listRoute = defineContractRoute(cmsModelContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsModels(c.req.valid('query'))), 200),
});

// 下拉源服务于栏目绑定，按栏目权限放行；普通请求必须提供 siteId，由 service 校验
const allRoute = defineContractRoute(cmsModelContract.all, {
  middleware: [authMiddleware, guard({ permission: 'cms:channel:list' })],
  handler: async (c) => c.json(okBody(await listAllCmsModels(c.req.valid('query').siteId)), 200),
});

const refsRoute = defineContractRoute(cmsModelContract.refs, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsModelRefs(
    c.req.valid('param').id,
    c.req.valid('query').siteId,
  )), 200),
});

const getOneRoute = defineContractRoute(cmsModelContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsModel(
    c.req.valid('param').id,
    c.req.valid('query').siteId,
  )), 200),
});

const createRouteDef = defineContractRoute(cmsModelContract.create, {
  middleware: [authMiddleware, guard({ permission: 'cms:model:create', audit: { description: '创建 CMS 内容模型', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsModel(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(cmsModelContract.update, {
  middleware: [authMiddleware, guard({ permission: 'cms:model:update', audit: { description: '更新 CMS 内容模型', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { siteId } = c.req.valid('query');
    setAuditBeforeData(c, await getCmsModel(id, siteId));
    return c.json(okBody(await updateCmsModel(id, c.req.valid('json'), siteId), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(cmsModelContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'cms:model:delete', audit: { description: '删除 CMS 内容模型', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { siteId } = c.req.valid('query');
    setAuditBeforeData(c, await getCmsModel(id, siteId));
    await deleteCmsModel(id, siteId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, allRoute, getOneRoute, refsRoute, createRouteDef, updateRouteDef, deleteRouteDef] as const);

export default router;
