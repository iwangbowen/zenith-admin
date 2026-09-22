import * as z from 'zod';
import { auditFieldsSchema, entityStatusQuery, entityStatusSchema, idParam, idQuery, keywordQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, fileField, multipart, op } from '../../core/contract';
import { uploadChunkBody, uploadChunkResultSchema, uploadSessionInitSchema, uploadSessionStatusSchema } from '../../platform/contracts';
import { completeChunkUploadSchema } from '../../platform/validation';
import { IOT_OTA_DEVICE_STATUSES, IOT_OTA_TASK_STATUSES } from '../constants';
import { createIotOtaTaskSchema, initIotFirmwareUploadSchema, updateIotFirmwareSchema, uploadIotFirmwareFieldsSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const iotFirmwareSchema = z.object({
  id: z.int(),
  productId: z.int(),
  productName: z.string().nullable(),
  version: z.string().meta({ description: '语义化版本（同产品唯一），设备上报一致即判定升级成功', example: '1.2.3' }),
  fileId: z.string().nullable().meta({ description: '托管文件 ID；文件被删时为 null（不可再下发）' }),
  fileName: z.string(),
  size: z.int(),
  sha256: z.string(),
  releaseNotes: z.string().nullable(),
  status: entityStatusSchema,
  taskCount: z.int().meta({ description: '升级任务数' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'IotFirmware' });

export type IotFirmware = z.infer<typeof iotFirmwareSchema>;

export const iotOtaTaskSchema = z.object({
  id: z.int(),
  title: z.string(),
  firmwareId: z.int(),
  productId: z.int(),
  productName: z.string().nullable(),
  firmwareVersion: z.string(),
  status: z.enum(IOT_OTA_TASK_STATUSES),
  timeoutMinutes: z.int().meta({ description: '单设备超时（分钟）：越期未终态判 failed' }),
  batchSize: z.int().nullable().meta({ description: '灰度批次大小（null = 全量一批）' }),
  currentBatch: z.int().meta({ description: '当前已放量到的批次号（从 1 开始）' }),
  totalBatches: z.int(),
  failureThreshold: z.int().nullable().meta({ description: '失败率熔断阈值（百分比；null = 不熔断）' }),
  totalCount: z.int(),
  succeededCount: z.int(),
  failedCount: z.int(),
  createdBy: z.int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'IotOtaTask' });

export type IotOtaTask = z.infer<typeof iotOtaTaskSchema>;

export const iotOtaTaskDeviceSchema = z.object({
  id: z.int(),
  taskId: z.int(),
  deviceId: z.int(),
  deviceName: z.string().nullable(),
  deviceSn: z.string().nullable(),
  online: z.boolean(),
  status: z.enum(IOT_OTA_DEVICE_STATUSES),
  progress: z.int().meta({ description: '下载 / 安装进度 0-100' }),
  fromVersion: z.string().nullable().meta({ description: '升级前固件版本快照' }),
  batchIndex: z.int().meta({ description: '灰度批次号（全量任务恒为 1）' }),
  errorMsg: z.string().nullable(),
  notifiedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
}).meta({ id: 'IotOtaTaskDevice' });

export type IotOtaTaskDevice = z.infer<typeof iotOtaTaskDeviceSchema>;

/** 设备侧 OTA 升级载荷（WS ota:upgrade 帧 / 心跳响应捎带） */
export const iotOtaPayloadSchema = z.object({
  taskId: z.int(),
  version: z.string(),
  fileName: z.string(),
  size: z.int(),
  sha256: z.string(),
  downloadPath: z.string().meta({ description: '设备侧带签名参数请求该地址下载固件' }),
}).meta({ id: 'IotOtaPayload' });

export type IotOtaPayload = z.infer<typeof iotOtaPayloadSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const iotFirmwareListQuery = paginationQuery.extend({
  keyword: keywordQuery('版本 / 文件名'),
  productId: idQuery(),
  status: entityStatusQuery,
});

export const iotOtaTaskListQuery = paginationQuery.extend({
  keyword: keywordQuery('任务标题 / 目标版本'),
  productId: idQuery(),
  status: queryEnum(IOT_OTA_TASK_STATUSES),
});

export const iotOtaTaskDeviceListQuery = paginationQuery.extend({
  status: queryEnum(IOT_OTA_DEVICE_STATUSES),
});

/** 固件上传：文本字段 + 固件文件 */
export const uploadIotFirmwareBody = multipart(uploadIotFirmwareFieldsSchema.extend({
  file: fileField('固件文件'),
}));

const firmwareUploadIdParam = z.object({
  uploadId: z.string().meta({ description: '分片上传会话 ID' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

const TAGS = ['IoT 固件'] as const;

export const iotFirmwareContract = defineContract('/api/iot/firmwares', {
  detail: op.get('/{id}', { access: { permission: 'iot:ota:list' }, params: idParam, response: iotFirmwareSchema, summary: '固件详情' }),
  list: op.get('/', { access: { permission: 'iot:ota:list' }, query: iotFirmwareListQuery, response: paginated(iotFirmwareSchema), summary: '固件包列表' }),
  upload: op.post('/', { access: { permission: 'iot:ota:firmware:manage' }, audit: { description: '上传 IoT 固件', recordBody: false }, body: uploadIotFirmwareBody, response: iotFirmwareSchema, summary: '上传固件包（单请求 multipart，服务端计算 SHA256；超过分片阈值用分片接口）' }),
  uploadInit: op.post('/upload/init', { access: { permission: 'iot:ota:firmware:manage' }, audit: '初始化 IoT 固件分片上传', body: initIotFirmwareUploadSchema, response: uploadSessionInitSchema, summary: '初始化固件分片上传' }),
  uploadChunk: op.post('/upload/chunk', { access: { permission: 'iot:ota:firmware:manage' }, body: uploadChunkBody, response: uploadChunkResultSchema, summary: '上传固件分片' }),
  uploadComplete: op.post('/upload/complete', { access: { permission: 'iot:ota:firmware:manage' }, audit: '完成 IoT 固件分片上传', body: completeChunkUploadSchema, response: iotFirmwareSchema, summary: '完成固件分片上传并登记（服务端计算 SHA256）' }),
  uploadStatus: op.get('/upload/{uploadId}/status', { access: 'authenticated', params: firmwareUploadIdParam, response: uploadSessionStatusSchema, summary: '固件分片上传进度' }),
  uploadAbort: op.delete('/upload/{uploadId}', { access: { permission: 'iot:ota:firmware:manage' }, audit: '中止 IoT 固件分片上传', params: firmwareUploadIdParam, summary: '中止固件分片上传' }),
  update: op.put('/{id}', { access: { permission: 'iot:ota:firmware:manage' }, audit: '更新 IoT 固件', params: idParam, body: updateIotFirmwareSchema, response: iotFirmwareSchema, summary: '更新固件（仅发布说明与状态；版本与文件不可变更）' }),
  remove: op.delete('/{id}', { access: { permission: 'iot:ota:firmware:manage' }, audit: '删除 IoT 固件', params: idParam, summary: '删除固件（存在升级任务时拒绝，托管文件一并回收）' }),
}, { auditModule: 'IoT 固件', tags: TAGS });

export const iotOtaTaskContract = defineContract('/api/iot/ota-tasks', {
  deviceDetail: op.get('/device-results/{id}', { access: { permission: 'iot:ota:list' }, params: idParam, response: iotOtaTaskDeviceSchema, summary: '单设备升级结果详情' }),
  list: op.get('/', { access: { permission: 'iot:ota:list' }, query: iotOtaTaskListQuery, response: paginated(iotOtaTaskSchema), summary: '升级任务列表' }),
  create: op.post('/', { access: { permission: 'iot:ota:task:create' }, audit: '创建 IoT 升级任务', body: createIotOtaTaskSchema, response: iotOtaTaskSchema, summary: '创建升级任务（WS 在线即推，离线心跳捎带；版本上报一致即成功）' }),
  detail: op.get('/{id}', { access: { permission: 'iot:ota:list' }, params: idParam, response: iotOtaTaskSchema, summary: '升级任务详情' }),
  devices: op.get('/{id}/devices', { access: { permission: 'iot:ota:list' }, params: idParam, query: iotOtaTaskDeviceListQuery, response: paginated(iotOtaTaskDeviceSchema), summary: '升级任务设备明细' }),
  cancel: op.post('/{id}/cancel', { access: { permission: 'iot:ota:task:create' }, audit: '取消 IoT 升级任务', params: idParam, response: iotOtaTaskSchema, summary: '取消升级任务（未终态设备一并取消）' }),
  releaseNextBatch: op.post('/{id}/release-next-batch', { access: { permission: 'iot:ota:task:create' }, audit: '放量 IoT 升级批次', params: idParam, response: iotOtaTaskSchema, summary: '放量下一批（灰度任务；暂停中的任务放量即恢复）' }),
  resume: op.post('/{id}/resume', { access: { permission: 'iot:ota:task:create' }, audit: '恢复 IoT 升级任务', params: idParam, response: iotOtaTaskSchema, summary: '恢复被熔断暂停的任务（继续当前批，不放量）' }),
}, { auditModule: 'IoT 固件', tags: TAGS });
