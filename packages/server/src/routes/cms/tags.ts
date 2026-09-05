import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsTagContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listCmsTags, listAllCmsTags, getCmsTag, createCmsTag, updateCmsTag, deleteCmsTag, ensureCmsTagExists, mapCmsTag,
} from '../../services/cms/cms-tags.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'cms:tag:list' })] as const;

const listRoute = defineContractRoute(cmsTagContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsTags(c.req.valid('query'))), 200),
});

// 内容打标下拉：按内容权限放行
const allRoute = defineContractRoute(cmsTagContract.all, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:list' })],
  handler: async (c) => c.json(okBody(await listAllCmsTags(c.req.valid('query').siteId)), 200),
});

const getOneRoute = defineContractRoute(cmsTagContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsTag(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(cmsTagContract.create, {
  middleware: [authMiddleware, guard({ permission: 'cms:tag:create', audit: { description: '创建 CMS 标签', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsTag(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(cmsTagContract.update, {
  middleware: [authMiddleware, guard({ permission: 'cms:tag:update', audit: { description: '更新 CMS 标签', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsTag(await ensureCmsTagExists(id)));
    return c.json(okBody(await updateCmsTag(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(cmsTagContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'cms:tag:delete', audit: { description: '删除 CMS 标签', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsTag(await ensureCmsTagExists(id)));
    await deleteCmsTag(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, allRoute, getOneRoute, createRouteDef, updateRouteDef, deleteRouteDef] as const);

export default router;
