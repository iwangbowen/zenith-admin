import { OpenAPIHono } from '@hono/zod-openapi';
import { dataMaskConfigContract } from '@zenith/shared/platform';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { platformAdminOnly } from '../../middleware/platform-admin';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listDataMaskConfigs,
  getDataMaskConfig,
  createDataMaskConfig,
  updateDataMaskConfig,
  deleteDataMaskConfig,
  scanSensitiveFields,
  batchCreateDataMaskConfigs,
} from '../../services/platform/data-mask.service';

const dataMaskConfigsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:data-mask:list' })] as const;

const dataMaskAdmin = platformAdminOnly({ message: '多租户模式下仅平台管理员可管理数据脱敏规则', onlyInMultiTenant: true });

const listRoute = defineContractRoute(dataMaskConfigContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listDataMaskConfigs(c.req.valid('query'))), 200),
});

const getOneRoute = defineContractRoute(dataMaskConfigContract.detail, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getDataMaskConfig(id)), 200);
  },
});

const createRouteDef = defineContractRoute(dataMaskConfigContract.create, {
  middleware: [authMiddleware, dataMaskAdmin, guard({ permission: 'system:data-mask:create', audit: { description: '创建脱敏规则', module: '数据脱敏配置' } })],
  handler: async (c) => c.json(okBody(await createDataMaskConfig(c.req.valid('json'))), 200),
});

const updateRoute = defineContractRoute(dataMaskConfigContract.update, {
  middleware: [authMiddleware, dataMaskAdmin, guard({ permission: 'system:data-mask:update', audit: { description: '更新脱敏规则', module: '数据脱敏配置' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    setAuditBeforeData(c, await getDataMaskConfig(id));
    return c.json(okBody(await updateDataMaskConfig(id, body)), 200);
  },
});

const deleteRoute = defineContractRoute(dataMaskConfigContract.remove, {
  middleware: [authMiddleware, dataMaskAdmin, guard({ permission: 'system:data-mask:delete', audit: { description: '删除脱敏规则', module: '数据脱敏配置' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getDataMaskConfig(id));
    await deleteDataMaskConfig(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const scanRoute = defineContractRoute(dataMaskConfigContract.scan, {
  middleware: read,
  handler: async (c) => c.json(okBody(await scanSensitiveFields()), 200),
});

const batchCreateRoute = defineContractRoute(dataMaskConfigContract.batchCreate, {
  middleware: [authMiddleware, dataMaskAdmin, guard({ permission: 'system:data-mask:create', audit: { description: '批量创建脱敏规则', module: '数据脱敏配置' } })],
  handler: async (c) => {
    const { items } = c.req.valid('json');
    const result = await batchCreateDataMaskConfigs(items);
    return c.json(okBody(result, `已创建 ${result.created} 条，跳过 ${result.skipped} 条`), 200);
  },
});

dataMaskConfigsRouter.openapiRoutes([listRoute, scanRoute, batchCreateRoute, getOneRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default dataMaskConfigsRouter;
