/**
 * IoT 总览仪表盘、固件包与 OTA 升级任务。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotDashboardContract, iotFirmwareContract, iotOtaTaskContract } from '@zenith/shared/iot';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { getIotDashboard } from '../../services/iot/iot-dashboard.service';
import {
  createIotFirmware, deleteIotFirmware, ensureIotFirmwareExists, listIotFirmwares,
  mapIotFirmware, updateIotFirmware,
} from '../../services/iot/iot-firmware.service';
import {
  cancelIotOtaTask, createIotOtaTask, getIotOtaTask, listIotOtaTaskDevices, listIotOtaTasks,
  releaseNextIotOtaBatch, resumeIotOtaTask,
} from '../../services/iot/iot-ota.service';

const otaRead = [authMiddleware, guard({ permission: 'iot:ota:list' })] as const;
const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

// ─── 仪表盘 ───────────────────────────────────────────────────────────────────
export const iotDashboardRouter = new OpenAPIHono({ defaultHook: validationHook });

const dashboardRoute = defineContractRoute(iotDashboardContract.overview, {
  middleware: [authMiddleware, guard({ permission: 'iot:dashboard:view' })],
  handler: async (c) => c.json(okBody(await getIotDashboard()), 200),
});

iotDashboardRouter.openapiRoutes([dashboardRoute] as const);

// ─── 固件包 ───────────────────────────────────────────────────────────────────
export const iotFirmwaresRouter = new OpenAPIHono({ defaultHook: validationHook });

const firmwareManage = (description: string, recordBody = true) => [authMiddleware, guard({
  permission: 'iot:ota:firmware:manage',
  audit: { description, module: 'IoT 固件', ...(recordBody ? {} : { recordBody: false }) },
})] as const;

const listFirmwaresRoute = defineContractRoute(iotFirmwareContract.list, {
  middleware: otaRead,
  handler: async (c) => c.json(okBody(await listIotFirmwares(c.req.valid('query'))), 200),
});

const uploadFirmwareRoute = defineContractRoute(iotFirmwareContract.upload, {
  middleware: firmwareManage('上传 IoT 固件', false),
  handler: async (c) => {
    const { file, productId, version, releaseNotes } = c.req.valid('form');
    if (!(file instanceof File)) return c.json(errBody('请选择要上传的固件文件', 400), 400);
    const row = await createIotFirmware({ productId, version, releaseNotes: releaseNotes || null }, file);
    return c.json(okBody(row, '上传成功'), 200);
  },
});

const updateFirmwareRoute = defineContractRoute(iotFirmwareContract.update, {
  middleware: firmwareManage('更新 IoT 固件'),
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotFirmware(await ensureIotFirmwareExists(id)));
    return c.json(okBody(await updateIotFirmware(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteFirmwareRoute = defineContractRoute(iotFirmwareContract.remove, {
  middleware: firmwareManage('删除 IoT 固件'),
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotFirmware(await ensureIotFirmwareExists(id)));
    await deleteIotFirmware(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

iotFirmwaresRouter.openapiRoutes([
  listFirmwaresRoute,
  uploadFirmwareRoute,
  updateFirmwareRoute,
  deleteFirmwareRoute,
] as const);

// ─── OTA 任务 ─────────────────────────────────────────────────────────────────
export const iotOtaTasksRouter = new OpenAPIHono({ defaultHook: validationHook });

const taskManage = (description: string) => [authMiddleware, guard({
  permission: 'iot:ota:task:create',
  audit: { description, module: 'IoT 固件' },
})] as const;

const listTasksRoute = defineContractRoute(iotOtaTaskContract.list, {
  middleware: otaRead,
  handler: async (c) => c.json(okBody(await listIotOtaTasks(c.req.valid('query'))), 200),
});

const createTaskRoute = defineContractRoute(iotOtaTaskContract.create, {
  middleware: taskManage('创建 IoT 升级任务'),
  handler: async (c) => c.json(okBody(await createIotOtaTask(c.req.valid('json')), '升级任务已创建'), 200),
});

const getTaskRoute = defineContractRoute(iotOtaTaskContract.detail, {
  middleware: otaRead,
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getIotOtaTask(id)), 200);
  },
});

const listTaskDevicesRoute = defineContractRoute(iotOtaTaskContract.devices, {
  middleware: otaRead,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listIotOtaTaskDevices(id, c.req.valid('query'))), 200);
  },
});

const cancelTaskRoute = defineContractRoute(iotOtaTaskContract.cancel, {
  middleware: taskManage('取消 IoT 升级任务'),
  responses: { 400: { content: jsonContent(ErrorResponse), description: '任务已结束' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await cancelIotOtaTask(id), '任务已取消'), 200);
  },
});

const releaseBatchRoute = defineContractRoute(iotOtaTaskContract.releaseNextBatch, {
  middleware: taskManage('放量 IoT 升级批次'),
  responses: { 400: { content: jsonContent(ErrorResponse), description: '任务已结束或无可放量批次' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await releaseNextIotOtaBatch(id), '下一批已放量'), 200);
  },
});

const resumeTaskRoute = defineContractRoute(iotOtaTaskContract.resume, {
  middleware: taskManage('恢复 IoT 升级任务'),
  responses: { 400: { content: jsonContent(ErrorResponse), description: '仅暂停中的任务可恢复' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await resumeIotOtaTask(id), '任务已恢复'), 200);
  },
});

iotOtaTasksRouter.openapiRoutes([
  listTasksRoute,
  createTaskRoute,
  getTaskRoute,
  listTaskDevicesRoute,
  cancelTaskRoute,
  releaseBatchRoute,
  resumeTaskRoute,
] as const);
