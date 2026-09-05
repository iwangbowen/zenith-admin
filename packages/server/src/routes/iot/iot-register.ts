/**
 * IoT 动态注册：白名单 + 产品注册密钥
 *
 * 设备侧注册端点在 ingest 路由（`iotIngestContract.register`，产品注册密钥签名）。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotWhitelistContract } from '@zenith/shared/iot';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createIotWhitelistEntries, deleteIotWhitelistEntry, disableIotRegistration,
  getIotWhitelistStats, listIotWhitelist, resetIotRegistrationSecret,
} from '../../services/iot/iot-register.service';

export const iotWhitelistRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'iot:register:manage' })] as const;
const manage = (description: string) => [authMiddleware, guard({
  permission: 'iot:register:manage',
  audit: { description, module: 'IoT 动态注册' },
})] as const;
const productNotFound = { 404: { content: jsonContent(ErrorResponse), description: '产品不存在' } } as const;

const statsRoute = defineContractRoute(iotWhitelistContract.stats, {
  middleware: read,
  handler: async (c) => {
    const { productId } = c.req.valid('query');
    return c.json(okBody(await getIotWhitelistStats(productId)), 200);
  },
});

const listRoute = defineContractRoute(iotWhitelistContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listIotWhitelist(c.req.valid('query'))), 200),
});

const importRoute = defineContractRoute(iotWhitelistContract.import, {
  middleware: manage('导入 IoT 注册白名单'),
  handler: async (c) => c.json(okBody(await createIotWhitelistEntries(c.req.valid('json')), '导入完成'), 200),
});

const deleteRoute_ = defineContractRoute(iotWhitelistContract.remove, {
  middleware: manage('删除 IoT 注册白名单'),
  responses: { 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteIotWhitelistEntry(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const resetSecretRoute = defineContractRoute(iotWhitelistContract.resetRegistrationSecret, {
  middleware: manage('重置 IoT 产品注册密钥'),
  responses: productNotFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await resetIotRegistrationSecret(id), '注册密钥已重置，请妥善保存'), 200);
  },
});

const disableSecretRoute = defineContractRoute(iotWhitelistContract.disableRegistration, {
  middleware: manage('关闭 IoT 产品动态注册'),
  responses: productNotFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await disableIotRegistration(id);
    return c.json(okBody(null, '动态注册已关闭'), 200);
  },
});

iotWhitelistRouter.openapiRoutes([
  statsRoute,
  listRoute,
  importRoute,
  deleteRoute_,
  resetSecretRoute,
  disableSecretRoute,
] as const);
