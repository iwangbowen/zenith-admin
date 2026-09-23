import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsModelContract } from '@zenith/shared/cms';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listCmsModels,
  listAllCmsModels,
  getCmsModel,
  createCmsModel,
  updateCmsModel,
  deleteCmsModel,
  getCmsModelRefs,
  publishCmsModel, listCmsModelVersions,
} from '../../services/cms/cms-models.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

// 下拉源服务于栏目绑定，按栏目权限放行；普通请求必须提供 siteId，由 service 校验
const allRoute = defineContractRoute(cmsModelContract.all, {
  handler: async (c) => c.json(okBody(await listAllCmsModels(c.req.valid('query').siteId)), 200),
});

const refsRoute = defineContractRoute(cmsModelContract.refs, {
  handler: async (c) => c.json(okBody(await getCmsModelRefs(
    c.req.valid('param').id,
    c.req.valid('query').siteId,
  )), 200),
});

const getOneRoute = defineContractRoute(cmsModelContract.detail, {
  handler: async (c) => c.json(okBody(await getCmsModel(
    c.req.valid('param').id,
    c.req.valid('query').siteId,
  )), 200),
});
const updateRouteDef = defineContractRoute(cmsModelContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { siteId } = c.req.valid('query');
    setAuditBeforeData(c, await getCmsModel(id, siteId));
    return c.json(okBody(await updateCmsModel(id, c.req.valid('json'), siteId), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(cmsModelContract.remove, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { siteId } = c.req.valid('query');
    setAuditBeforeData(c, await getCmsModel(id, siteId));
    await deleteCmsModel(id, siteId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mountCrud(router, cmsModelContract,
  { list: listCmsModels, create: createCmsModel },
  { exclude: ['detail', 'update', 'remove'] },
  [allRoute, getOneRoute, refsRoute, updateRouteDef, deleteRouteDef,
    defineContractRoute(cmsModelContract.versions, { handler: async (c) => c.json(okBody(await listCmsModelVersions(c.req.valid('param').id, c.req.valid('query').siteId)), 200) }),
    defineContractRoute(cmsModelContract.publish, { handler: async (c) => c.json(okBody(await publishCmsModel(c.req.valid('param').id, c.req.valid('query').siteId), '模型版本已发布'), 200) }),
  ],
);

export default router;
