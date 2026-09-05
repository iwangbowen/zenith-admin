/**
 * IoT 产品管理：产品 CRUD + 物模型（属性/服务/事件）与 TSL 导入导出
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotProductContract } from '@zenith/shared/iot';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listIotProducts, listAllIotProducts, getIotProduct, createIotProduct,
  updateIotProduct, deleteIotProduct, ensureIotProductExists, mapIotProduct,
} from '../../services/iot/iot-devices.service';
import {
  createIotEvent, createIotProperty, createIotService, deleteIotEvent, deleteIotProperty, deleteIotService,
  ensureIotEventExists, ensureIotPropertyExists, ensureIotServiceExists, getThingModel, importIotTsl,
  mapIotEvent, mapIotProperty, mapIotService, updateIotEvent, updateIotProperty, updateIotService,
} from '../../services/iot/iot-model.service';

const iotProductsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'iot:product:list' })] as const;
const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

const listRoute = defineContractRoute(iotProductContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listIotProducts(c.req.valid('query'))), 200),
});

const allRoute = defineContractRoute(iotProductContract.all, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listAllIotProducts()), 200),
});

const getOneRoute = defineContractRoute(iotProductContract.detail, {
  middleware: read,
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getIotProduct(id)), 200);
  },
});

const createRoute_ = defineContractRoute(iotProductContract.create, {
  middleware: [authMiddleware, guard({
    permission: 'iot:product:create',
    audit: { description: '创建 IoT 产品', module: 'IoT 产品' },
  })],
  handler: async (c) => c.json(okBody(await createIotProduct(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineContractRoute(iotProductContract.update, {
  middleware: [authMiddleware, guard({
    permission: 'iot:product:update',
    audit: { description: '更新 IoT 产品', module: 'IoT 产品' },
  })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotProduct(await ensureIotProductExists(id)));
    return c.json(okBody(await updateIotProduct(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineContractRoute(iotProductContract.remove, {
  middleware: [authMiddleware, guard({
    permission: 'iot:product:delete',
    audit: { description: '删除 IoT 产品', module: 'IoT 产品' },
  })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotProduct(await ensureIotProductExists(id)));
    await deleteIotProduct(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 物模型 ───────────────────────────────────────────────────────────────────
const modelWrite = (description: string) => [authMiddleware, guard({
  permission: 'iot:product:update',
  audit: { description, module: 'IoT 产品' },
})] as const;

const getModelRoute = defineContractRoute(iotProductContract.model, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await ensureIotProductExists(id);
    return c.json(okBody(await getThingModel(id)), 200);
  },
});

const importModelRoute = defineContractRoute(iotProductContract.importModel, {
  middleware: modelWrite('导入 IoT 物模型'),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await ensureIotProductExists(id);
    return c.json(okBody(await importIotTsl(id, c.req.valid('json')), '物模型已导入'), 200);
  },
});

const createPropertyRoute = defineContractRoute(iotProductContract.createProperty, {
  middleware: modelWrite('新增 IoT 物模型属性'),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await ensureIotProductExists(id);
    return c.json(okBody(await createIotProperty(id, c.req.valid('json')), '创建成功'), 200);
  },
});

const updatePropertyRoute = defineContractRoute(iotProductContract.updateProperty, {
  middleware: modelWrite('更新 IoT 物模型属性'),
  handler: async (c) => {
    const { id, propertyId } = c.req.valid('param');
    await ensureIotProductExists(id);
    setAuditBeforeData(c, mapIotProperty(await ensureIotPropertyExists(id, propertyId)));
    return c.json(okBody(await updateIotProperty(id, propertyId, c.req.valid('json')), '更新成功'), 200);
  },
});

const deletePropertyRoute = defineContractRoute(iotProductContract.removeProperty, {
  middleware: modelWrite('删除 IoT 物模型属性'),
  handler: async (c) => {
    const { id, propertyId } = c.req.valid('param');
    await ensureIotProductExists(id);
    setAuditBeforeData(c, mapIotProperty(await ensureIotPropertyExists(id, propertyId)));
    await deleteIotProperty(id, propertyId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const createServiceRoute = defineContractRoute(iotProductContract.createService, {
  middleware: modelWrite('新增 IoT 物模型服务'),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await ensureIotProductExists(id);
    return c.json(okBody(await createIotService(id, c.req.valid('json')), '创建成功'), 200);
  },
});

const updateServiceRoute = defineContractRoute(iotProductContract.updateService, {
  middleware: modelWrite('更新 IoT 物模型服务'),
  handler: async (c) => {
    const { id, serviceId } = c.req.valid('param');
    await ensureIotProductExists(id);
    setAuditBeforeData(c, mapIotService(await ensureIotServiceExists(id, serviceId)));
    return c.json(okBody(await updateIotService(id, serviceId, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteServiceRoute = defineContractRoute(iotProductContract.removeService, {
  middleware: modelWrite('删除 IoT 物模型服务'),
  handler: async (c) => {
    const { id, serviceId } = c.req.valid('param');
    await ensureIotProductExists(id);
    setAuditBeforeData(c, mapIotService(await ensureIotServiceExists(id, serviceId)));
    await deleteIotService(id, serviceId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const createEventRoute = defineContractRoute(iotProductContract.createEvent, {
  middleware: modelWrite('新增 IoT 物模型事件'),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await ensureIotProductExists(id);
    return c.json(okBody(await createIotEvent(id, c.req.valid('json')), '创建成功'), 200);
  },
});

const updateEventRoute = defineContractRoute(iotProductContract.updateEvent, {
  middleware: modelWrite('更新 IoT 物模型事件'),
  handler: async (c) => {
    const { id, eventId } = c.req.valid('param');
    await ensureIotProductExists(id);
    setAuditBeforeData(c, mapIotEvent(await ensureIotEventExists(id, eventId)));
    return c.json(okBody(await updateIotEvent(id, eventId, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteEventRoute = defineContractRoute(iotProductContract.removeEvent, {
  middleware: modelWrite('删除 IoT 物模型事件'),
  handler: async (c) => {
    const { id, eventId } = c.req.valid('param');
    await ensureIotProductExists(id);
    setAuditBeforeData(c, mapIotEvent(await ensureIotEventExists(id, eventId)));
    await deleteIotEvent(id, eventId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

iotProductsRouter.openapiRoutes([
  listRoute,
  allRoute,
  getModelRoute,
  importModelRoute,
  createPropertyRoute,
  updatePropertyRoute,
  deletePropertyRoute,
  createServiceRoute,
  updateServiceRoute,
  deleteServiceRoute,
  createEventRoute,
  updateEventRoute,
  deleteEventRoute,
  getOneRoute,
  createRoute_,
  updateRoute_,
  deleteRoute_,
] as const);

export default iotProductsRouter;
