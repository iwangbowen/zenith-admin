/**
 * IoT 总览仪表盘、固件包与 OTA 升级任务。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotDashboardContract, iotFirmwareContract, iotOtaTaskContract } from '@zenith/shared/iot';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { getIotDashboard } from '../../services/iot/iot-dashboard.service';
import {
  abortIotFirmwareUpload,
  completeIotFirmwareUpload,
  createIotFirmware,
  deleteIotFirmware,
  getIotFirmware,
  getIotFirmwareUploadStatus,
  initIotFirmwareUpload,
  listIotFirmwares,
  updateIotFirmware,
  uploadIotFirmwareChunk,
} from '../../services/iot/iot-firmware.service';
import {
  cancelIotOtaTask,
  createIotOtaTask,
  getIotOtaTask,
  getIotOtaTaskDevice,
  listIotOtaTaskDevices,
  listIotOtaTasks,
  releaseNextIotOtaBatch,
  resumeIotOtaTask,
} from '../../services/iot/iot-ota.service';
import { mountCrud } from '../_crud';

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

// ─── 仪表盘 ───────────────────────────────────────────────────────────────────
export const iotDashboardRouter = new OpenAPIHono({ defaultHook: validationHook });

const dashboardRoute = defineContractRoute(iotDashboardContract.overview, {
  handler: async (c) => c.json(okBody(await getIotDashboard()), 200),
});

iotDashboardRouter.openapiRoutes([dashboardRoute] as const);

// ─── 固件包 ───────────────────────────────────────────────────────────────────
export const iotFirmwaresRouter = new OpenAPIHono({ defaultHook: validationHook });

const uploadFirmwareRoute = defineContractRoute(iotFirmwareContract.upload, {
  handler: async (c) => {
    const { file, productId, version, releaseNotes } = c.req.valid('form');
    if (!(file instanceof File)) return c.json(errBody('请选择要上传的固件文件', 400), 400);
    const row = await createIotFirmware({ productId, version, releaseNotes: releaseNotes || null }, file);
    return c.json(okBody(row, '上传成功'), 200);
  },
});

// 固件分片上传：会话归属校验在 service（绑定表按发起人过滤）
const firmwareUploadInitRoute = defineContractRoute(iotFirmwareContract.uploadInit, {
  responses: notFound,
  handler: async (c) => c.json(okBody(await initIotFirmwareUpload(c.req.valid('json'))), 200),
});

const firmwareUploadChunkRoute = defineContractRoute(iotFirmwareContract.uploadChunk, {
  handler: async (c) => {
    const body = await c.req.parseBody();
    const uploadId = String(body.uploadId ?? '');
    const index = Number(body.index);
    const chunk = body.chunk;
    if (!uploadId || !Number.isFinite(index) || !(chunk instanceof File)) {
      return c.json(errBody('分片参数不完整', 400), 400);
    }
    return c.json(okBody(await uploadIotFirmwareChunk(uploadId, index, chunk)), 200);
  },
});

const firmwareUploadCompleteRoute = defineContractRoute(iotFirmwareContract.uploadComplete, {
  responses: { 400: { content: jsonContent(ErrorResponse), description: '分片不完整或校验失败' } },
  handler: async (c) => c.json(okBody(await completeIotFirmwareUpload(c.req.valid('json').uploadId), '上传成功'), 200),
});

const firmwareUploadStatusRoute = defineContractRoute(iotFirmwareContract.uploadStatus, {
  responses: { 404: { content: jsonContent(ErrorResponse), description: '会话不存在' } },
  handler: async (c) => c.json(okBody(await getIotFirmwareUploadStatus(c.req.valid('param').uploadId)), 200),
});

const firmwareUploadAbortRoute = defineContractRoute(iotFirmwareContract.uploadAbort, {
  handler: async (c) => {
    await abortIotFirmwareUpload(c.req.valid('param').uploadId);
    return c.json(okBody(null, '已中止'), 200);
  },
});

mountCrud(iotFirmwaresRouter, iotFirmwareContract,
  {
    list: listIotFirmwares,
    get: getIotFirmware,
    update: updateIotFirmware,
    remove: deleteIotFirmware,
  },
  {
    responses: { update: notFound, remove: notFound },
  },
  [
    uploadFirmwareRoute,
    firmwareUploadInitRoute,
    firmwareUploadChunkRoute,
    firmwareUploadCompleteRoute,
    firmwareUploadStatusRoute,
    firmwareUploadAbortRoute,
  ],
);

// ─── OTA 任务 ─────────────────────────────────────────────────────────────────
export const iotOtaTasksRouter = new OpenAPIHono({ defaultHook: validationHook });

const deviceDetailRoute = defineContractRoute(iotOtaTaskContract.deviceDetail, {
  handler: async (c) => c.json(okBody(await getIotOtaTaskDevice(c.req.valid('param').id)), 200),
});

const listTaskDevicesRoute = defineContractRoute(iotOtaTaskContract.devices, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listIotOtaTaskDevices(id, c.req.valid('query'))), 200);
  },
});

const cancelTaskRoute = defineContractRoute(iotOtaTaskContract.cancel, {
  responses: { 400: { content: jsonContent(ErrorResponse), description: '任务已结束' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await cancelIotOtaTask(id), '任务已取消'), 200);
  },
});

const releaseBatchRoute = defineContractRoute(iotOtaTaskContract.releaseNextBatch, {
  responses: { 400: { content: jsonContent(ErrorResponse), description: '任务已结束或无可放量批次' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await releaseNextIotOtaBatch(id), '下一批已放量'), 200);
  },
});

const resumeTaskRoute = defineContractRoute(iotOtaTaskContract.resume, {
  responses: { 400: { content: jsonContent(ErrorResponse), description: '仅暂停中的任务可恢复' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await resumeIotOtaTask(id), '任务已恢复'), 200);
  },
});

mountCrud(iotOtaTasksRouter, iotOtaTaskContract,
  { list: listIotOtaTasks, get: getIotOtaTask, create: createIotOtaTask },
  {
    messages: { create: '升级任务已创建' },
    responses: { detail: notFound },
  },
  [deviceDetailRoute, listTaskDevicesRoute, cancelTaskRoute, releaseBatchRoute, resumeTaskRoute],
);
