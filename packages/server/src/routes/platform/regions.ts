import { OpenAPIHono } from '@hono/zod-openapi';
import { regionContract } from '@zenith/shared/platform';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { platformAdminOnly } from '../../middleware/platform-admin';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listRegionTree,
  listRegionsFlat,
  createRegion,
  updateRegion,
  deleteRegion,
  getRegionBeforeAudit,
  getRegion,
} from '../../services/platform/regions.service';

const regionsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:region:list' })] as const;

const globalRegionAdmin = platformAdminOnly({ message: '多租户模式下仅平台管理员可管理全局地区数据', onlyInMultiTenant: true });

const listRoute = defineContractRoute(regionContract.tree, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listRegionTree(c.req.valid('query'))), 200),
});

const flatRoute = defineContractRoute(regionContract.flat, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listRegionsFlat()), 200),
});

const getOneRoute = defineContractRoute(regionContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getRegion(c.req.valid('param').id)), 200),
});

const createRegionRoute = defineContractRoute(regionContract.create, {
  middleware: [authMiddleware, globalRegionAdmin, guard({ permission: 'system:region:create', audit: { description: '创建地区', module: '地区管理' } })],
  handler: async (c) => c.json(okBody(await createRegion(c.req.valid('json')), '创建成功'), 200),
});

const updateRegionRoute = defineContractRoute(regionContract.update, {
  middleware: [authMiddleware, globalRegionAdmin, guard({ permission: 'system:region:update', audit: { description: '更新地区', module: '地区管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getRegionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateRegion(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(regionContract.remove, {
  middleware: [authMiddleware, globalRegionAdmin, guard({ permission: 'system:region:delete', audit: { description: '删除地区', module: '地区管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getRegionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteRegion(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

regionsRouter.openapiRoutes([listRoute, flatRoute, getOneRoute, createRegionRoute, updateRegionRoute, deleteRoute] as const);

export default regionsRouter;
