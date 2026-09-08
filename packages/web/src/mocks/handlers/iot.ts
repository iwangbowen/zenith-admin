import { percentOf } from '@zenith/shared/core';
import type {
  IotAlarmRule, IotAutomation, IotDevice, IotDeviceShadow, IotFirmware, IotForwardRule,
  IotMaintenanceWindow, IotOtaTask, IotProduct, IotProductEvent, IotProductProperty, IotProductService, IotSchedule,
} from '@zenith/shared/iot';
import {
  iotAlarmContract, iotAlarmRuleContract, iotAutomationContract, iotBatchContract, iotDashboardContract,
  iotDeviceContract, iotDeviceGroupContract, iotFirmwareContract, iotForwardRuleContract, iotMaintenanceWindowContract,
  iotOtaTaskContract, iotProductContract, iotScheduleContract, iotWhitelistContract,
} from '@zenith/shared/iot';
import type { AsyncTask } from '@zenith/shared/tasks';
import { mock } from '@/mocks/utils/contract';
import { removeByIds, requireItem, updateItem } from '@/mocks/utils/crud';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import {
  buildMockTelemetry, buildMockTelemetryAgg, getNextIotAlarmRuleId, getNextIotAutomationId, getNextIotCommandId, getNextIotDeviceId,
  getNextIotFirmwareId, getNextIotForwardRuleId, getNextIotGroupId, getNextIotMaintenanceWindowId, getNextIotModelItemId, getNextIotOtaTaskDeviceId,
  getNextIotOtaTaskId, getNextIotProductId, getNextIotScheduleId, getNextIotWhitelistId,
  mockIotAlarmRules, mockIotAlarms, mockIotAutomationRuns, mockIotAutomations, mockIotCommands, mockIotDeviceEvents, mockIotDeviceLogs, mockIotDevices,
  mockIotEvents, mockIotFirmwares, mockIotForwardLogs, mockIotForwardRules, mockIotGroups, mockIotMaintenanceWindows, mockIotOtaTaskDevices, mockIotOtaTasks,
  mockIotProducts, mockIotProperties, mockIotScheduleRuns, mockIotSchedules, mockIotServices, mockIotShadows, mockIotWhitelist, withGroupInfo,
} from '../data/iot';
import { mockDateTime } from '../utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';
import { abortMockUploadSession, completeMockUploadSession, initMockUploadSession, mockUploadSessionStatus, receiveMockUploadChunk } from '@/mocks/utils/upload-sessions';

function randomHex(len: number): string {
  const chars = '0123456789abcdef';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * 16)]).join('');
}

function productWithCounts(p: IotProduct): IotProduct {
  return {
    ...p,
    deviceCount: mockIotDevices.filter((d) => d.productId === p.id).length,
    propertyCount: mockIotProperties.filter((x) => x.productId === p.id).length,
    serviceCount: mockIotServices.filter((x) => x.productId === p.id).length,
    eventCount: mockIotEvents.filter((x) => x.productId === p.id).length,
  };
}

function getShadow(deviceId: number): IotDeviceShadow {
  let shadow = mockIotShadows.get(deviceId);
  if (!shadow) {
    shadow = {
      deviceId, reported: {}, reportedAt: null, desired: {}, desiredVersion: 0,
      desiredAt: null, online: false, updatedAt: mockDateTime(),
    };
    mockIotShadows.set(deviceId, shadow);
  }
  return shadow;
}

/** 批量目标集：显式设备 ∪ 分组成员 */
function resolveBatchTargets(deviceIds: number[] | undefined, groupId: number | undefined): Set<number> {
  const ids = new Set(deviceIds ?? []);
  if (groupId) {
    const group = mockIotGroups.find((g) => g.id === groupId);
    for (const id of group?.deviceIds ?? []) ids.add(id);
  }
  return ids;
}

/** Demo 模式下批量操作同步完成，返回一条已结束的任务中心记录 */
function completedBatchTask(taskType: string, title: string, deviceCount: number): AsyncTask {
  const now = mockDateTime();
  return {
    id: Date.now(), taskType, title, module: 'IoT 设备', status: 'success', payload: {},
    totalCount: deviceCount, processedCount: deviceCount, failedCount: 0, progressNote: null, result: null,
    errorMessage: null, cancelRequested: false, attempts: 1, maxAttempts: 1, retryDelayMs: 5000, nextRunAt: null,
    createdBy: 1, createdByName: 'admin', tenantId: null, traceId: null,
    startedAt: now, completedAt: now, createdAt: now, updatedAt: now,
  };
}

function thingModelOf(productId: number) {
  return {
    properties: mockIotProperties.filter((x) => x.productId === productId),
    services: mockIotServices.filter((x) => x.productId === productId),
    events: mockIotEvents.filter((x) => x.productId === productId),
  };
}

export const iotHandlers = [
  // ─── 总览仪表盘 ──────────────────────────────────────────────────────────────
  mock(iotDashboardContract.overview, ({ ok }) => {
    const total = mockIotDevices.filter((d) => d.status === 'enabled').length;
    const online = mockIotDevices.filter((d) => d.online).length;
    const firing = mockIotAlarms.filter((a) => a.status === 'firing');
    const now = Date.now();
    const pad = (n: number) => String(n).padStart(2, '0');
    const onlineTrend = Array.from({ length: 144 }, (_, i) => {
      const at = new Date(now - (143 - i) * 600_000);
      return {
        time: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:00`,
        total,
        online: i > 100 ? online : Math.max(0, online - (i % 7 === 0 ? 1 : 0)),
      };
    });
    const alarmTrend = Array.from({ length: 7 }, (_, i) => {
      const at = new Date(now - (6 - i) * 86_400_000);
      return {
        date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
        warning: i === 6 ? 1 : (i % 3 === 0 ? 1 : 0),
        critical: i === 6 ? firing.filter((a) => a.level === 'critical').length : 0,
      };
    });
    return ok({
      stats: {
        deviceTotal: total,
        onlineCount: online,
        onlineRate: percentOf(online, total) ?? 0,
        telemetryToday: 2880,
        firingWarning: firing.filter((a) => a.level === 'warning').length,
        firingCritical: firing.filter((a) => a.level === 'critical').length,
        pendingDesiredDevices: [...mockIotShadows.values()].filter((s) => Object.keys(s.desired).length > 0).length,
        productTotal: mockIotProducts.length,
      },
      onlineTrend,
      alarmTrend,
      productDistribution: mockIotProducts.map((p) => ({
        name: p.name,
        value: mockIotDevices.filter((d) => d.productId === p.id).length,
      })),
      recentAlarms: [...mockIotAlarms].sort((a, b) => b.id - a.id).slice(0, 5),
      recentEvents: [...mockIotDeviceEvents].sort((a, b) => b.id - a.id).slice(0, 8).map((e) => ({
        ...e,
        deviceName: mockIotDevices.find((d) => d.id === e.deviceId)?.name ?? null,
      })),
    });
  }),

  // ─── 固件包 ──────────────────────────────────────────────────────────────────
  mock(iotFirmwareContract.list, ({ query, ok, paginate }) => {
    let list = mockIotFirmwares.map((f) => ({
      ...f,
      taskCount: mockIotOtaTasks.filter((t) => t.firmwareId === f.id).length,
    }));
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(f) => f.version, (f) => f.fileName]);
    if (query.productId) list = list.filter((f) => f.productId === query.productId);
    if (query.status) list = list.filter((f) => f.status === query.status);
    return ok(paginate(list.sort((a, b) => b.id - a.id)));
  }),
  mock(iotFirmwareContract.upload, ({ body, ok }) => {
    const file = body.get('file');
    const productId = Number(body.get('productId'));
    const version = String(body.get('version') ?? '');
    const product = mockIotProducts.find((p) => p.id === productId);
    if (!product) return badRequest('所属产品不存在', { status: 400 });
    if (!(file instanceof File)) return badRequest('请选择要上传的固件文件', { status: 400 });
    if (mockIotFirmwares.some((f) => f.productId === productId && f.version === version)) {
      return badRequest(`产品下已存在版本 ${version}`, { status: 400 });
    }
    const now = mockDateTime();
    const firmware: IotFirmware = {
      id: getNextIotFirmwareId(),
      productId,
      productName: product.name,
      version,
      fileId: `demo-firmware-file-${Date.now()}`,
      fileName: file.name,
      size: file.size,
      sha256: 'd'.repeat(64),
      releaseNotes: (body.get('releaseNotes') as string) || null,
      status: 'enabled',
      taskCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockIotFirmwares.push(firmware);
    return ok(firmware, '上传成功');
  }),
  // 固件分片上传：会话 meta 记录产品 / 版本 / 说明，complete 时登记固件
  mock(iotFirmwareContract.uploadInit, ({ body, ok }) => {
    const product = mockIotProducts.find((p) => p.id === body.productId);
    if (!product) return badRequest('所属产品不存在', { status: 400 });
    if (mockIotFirmwares.some((f) => f.productId === body.productId && f.version === body.version)) {
      return badRequest(`产品下已存在版本 ${body.version}`, { status: 400 });
    }
    const session = initMockUploadSession(body, { productId: body.productId, version: body.version, releaseNotes: body.releaseNotes ?? null });
    return session ? ok(session) : badRequest('文件过大：超过分片上传上限', { status: 400 });
  }),
  mock(iotFirmwareContract.uploadChunk, ({ body, ok }) => {
    const result = receiveMockUploadChunk(String(body.get('uploadId') ?? ''), Number(body.get('index')));
    return result ? ok(result) : notFound('上传会话不存在', { status: 404 });
  }),
  mock(iotFirmwareContract.uploadComplete, ({ body, ok }) => {
    const session = completeMockUploadSession<{ productId: number; version: string; releaseNotes: string | null }>(body.uploadId);
    if (!session) return notFound('上传会话不存在', { status: 404 });
    const product = mockIotProducts.find((p) => p.id === session.meta.productId);
    const now = mockDateTime();
    const firmware: IotFirmware = {
      id: getNextIotFirmwareId(),
      productId: session.meta.productId,
      productName: product?.name ?? null,
      version: session.meta.version,
      fileId: `demo-firmware-file-${Date.now()}`,
      fileName: session.fileName,
      size: session.fileSize,
      sha256: 'd'.repeat(64),
      releaseNotes: session.meta.releaseNotes,
      status: 'enabled',
      taskCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockIotFirmwares.push(firmware);
    return ok(firmware, '上传成功');
  }),
  mock(iotFirmwareContract.uploadStatus, ({ params, ok }) => {
    const status = mockUploadSessionStatus(params.uploadId);
    return status ? ok(status) : notFound('上传会话不存在', { status: 404 });
  }),
  mock(iotFirmwareContract.uploadAbort, ({ params, ok }) => {
    abortMockUploadSession(params.uploadId);
    return ok(null, '已中止');
  }),
  mock(iotFirmwareContract.update, ({ params, body, ok }) => {
    const firmware = updateItem(mockIotFirmwares, params.id, body, { notFoundMessage: '固件不存在', now: mockDateTime, init: { status: 404 } });
    return ok(firmware, '更新成功');
  }),
  mock(iotFirmwareContract.remove, ({ params, ok }) => {
    const idx = mockIotFirmwares.findIndex((f) => f.id === params.id);
    if (idx === -1) return notFound('固件不存在', { status: 404 });
    if (mockIotOtaTasks.some((t) => t.firmwareId === params.id)) return badRequest('该固件存在升级任务，不可删除', { status: 400 });
    mockIotFirmwares.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ─── OTA 升级任务 ────────────────────────────────────────────────────────────
  mock(iotOtaTaskContract.list, ({ query, ok, paginate }) => {
    let list = [...mockIotOtaTasks];
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(t) => t.title, (t) => t.firmwareVersion]);
    if (query.productId) list = list.filter((t) => t.productId === query.productId);
    if (query.status) list = list.filter((t) => t.status === query.status);
    return ok(paginate(list.sort((a, b) => b.id - a.id)));
  }),
  mock(iotOtaTaskContract.create, ({ body, ok }) => {
    const firmware = requireItem(mockIotFirmwares, body.firmwareId, '固件不存在', { status: 404 });
    const ids = resolveBatchTargets(body.deviceIds, body.groupId);
    if (body.allDevices) {
      for (const d of mockIotDevices.filter((d) => d.productId === firmware.productId)) ids.add(d.id);
    }
    const eligible = mockIotDevices.filter((d) =>
      ids.has(d.id) && d.productId === firmware.productId && d.status === 'enabled' && d.firmwareVersion !== firmware.version);
    if (eligible.length === 0) return badRequest('没有可升级的目标设备（需属于该固件产品、启用且版本不同）', { status: 400 });
    const now = mockDateTime();
    const batchSize = body.batchSize ?? null;
    const totalBatches = batchSize ? Math.ceil(eligible.length / batchSize) : 1;
    const task: IotOtaTask = {
      id: getNextIotOtaTaskId(),
      title: `升级到 v${firmware.version}（${eligible.length} 台）`,
      firmwareId: firmware.id,
      productId: firmware.productId,
      productName: firmware.productName ?? null,
      firmwareVersion: firmware.version,
      status: 'running',
      timeoutMinutes: body.timeoutMinutes,
      batchSize,
      currentBatch: 1,
      totalBatches,
      failureThreshold: body.failureThreshold ?? null,
      totalCount: eligible.length,
      succeededCount: 0,
      failedCount: 0,
      createdBy: 1,
      createdAt: now,
      updatedAt: now,
    };
    mockIotOtaTasks.push(task);
    eligible.forEach((d, i) => {
      const batchIndex = batchSize ? Math.floor(i / batchSize) + 1 : 1;
      const inFirstBatch = batchIndex === 1;
      mockIotOtaTaskDevices.push({
        id: getNextIotOtaTaskDeviceId(),
        taskId: task.id,
        deviceId: d.id,
        deviceName: d.name,
        deviceSn: d.sn,
        online: d.online,
        status: inFirstBatch && d.online ? 'notified' : 'pending',
        progress: 0,
        fromVersion: d.firmwareVersion,
        batchIndex,
        errorMsg: null,
        notifiedAt: inFirstBatch && d.online ? now : null,
        finishedAt: null,
      });
    });
    return ok(task, '升级任务已创建');
  }),
  mock(iotOtaTaskContract.devices, ({ params, query, ok, paginate }) => {
    let list = mockIotOtaTaskDevices.filter((d) => d.taskId === params.id);
    // Demo 模式：进行中任务的设备进度随读取推进，最终收敛为成功
    for (const row of list) {
      if (row.status === 'notified' || row.status === 'downloading' || row.status === 'installing') {
        row.progress = Math.min(100, row.progress + 25);
        if (row.progress < 60) row.status = 'downloading';
        else if (row.progress < 100) row.status = 'installing';
        else {
          row.status = 'succeeded';
          row.finishedAt = mockDateTime();
          const task = mockIotOtaTasks.find((t) => t.id === row.taskId);
          if (task) {
            task.succeededCount += 1;
            const active = mockIotOtaTaskDevices.filter((d) =>
              d.taskId === task.id && ['pending', 'notified', 'downloading', 'installing'].includes(d.status));
            if (active.length === 0) task.status = 'completed';
            const device = mockIotDevices.find((d) => d.id === row.deviceId);
            if (device) device.firmwareVersion = task.firmwareVersion;
          }
        }
      }
    }
    if (query.status) list = list.filter((d) => d.status === query.status);
    return ok(paginate([...list].sort((a, b) => b.id - a.id)));
  }),
  mock(iotOtaTaskContract.releaseNextBatch, ({ params, ok }) => {
    const task = requireItem(mockIotOtaTasks, params.id, '升级任务不存在', { status: 404 });
    if (!task.batchSize || !task.totalBatches) return badRequest('该任务不是灰度任务', { status: 400 });
    if (task.currentBatch >= task.totalBatches) return badRequest('所有批次均已放量', { status: 400 });
    task.currentBatch += 1;
    if (task.status === 'paused') task.status = 'running';
    for (const d of mockIotOtaTaskDevices.filter((d) => d.taskId === task.id && d.batchIndex === task.currentBatch && d.status === 'pending')) {
      d.status = 'notified';
      d.notifiedAt = mockDateTime();
    }
    return ok(task, `已放量第 ${task.currentBatch} 批`);
  }),
  mock(iotOtaTaskContract.resume, ({ params, ok }) => {
    const task = requireItem(mockIotOtaTasks, params.id, '升级任务不存在', { status: 404 });
    if (task.status !== 'paused') return badRequest('仅熔断暂停的任务可恢复', { status: 400 });
    task.status = 'running';
    return ok(task, '任务已恢复');
  }),
  mock(iotOtaTaskContract.cancel, ({ params, ok }) => {
    const task = requireItem(mockIotOtaTasks, params.id, '升级任务不存在', { status: 404 });
    if (task.status !== 'running' && task.status !== 'paused') return badRequest('任务已结束，无法取消', { status: 400 });
    task.status = 'cancelled';
    for (const d of mockIotOtaTaskDevices.filter((d) => d.taskId === task.id)) {
      if (['pending', 'notified', 'downloading', 'installing'].includes(d.status)) {
        d.status = 'cancelled';
        d.finishedAt = mockDateTime();
      }
    }
    return ok(task, '任务已取消');
  }),
  mock(iotOtaTaskContract.detail, ({ params, ok }) => {
    const task = requireItem(mockIotOtaTasks, params.id, '升级任务不存在', { status: 404 });
    return ok(task);
  }),

  // ─── 产品 ────────────────────────────────────────────────────────────────────
  mock(iotProductContract.all, ({ ok }) =>
    ok(mockIotProducts.filter((p) => p.status === 'enabled').map(productWithCounts))),
  mock(iotProductContract.list, ({ query, ok, paginate }) => {
    let list = mockIotProducts.map(productWithCounts);
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(p) => p.name, (p) => p.description]);
    if (query.status) list = list.filter((p) => p.status === query.status);
    return ok(paginate([...list].sort((a, b) => b.id - a.id)));
  }),
  mock(iotProductContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const product: IotProduct = {
      id: getNextIotProductId(),
      name: body.name,
      description: body.description ?? null,
      validationMode: body.validationMode,
      status: body.status,
      registrationEnabled: false,
      deviceCount: 0,
      propertyCount: 0,
      serviceCount: 0,
      eventCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockIotProducts.push(product);
    return ok(product, '创建成功');
  }),

  // ─── 物模型 ──────────────────────────────────────────────────────────────────
  mock(iotProductContract.model, ({ params, ok }) => {
    if (!mockIotProducts.some((p) => p.id === params.id)) return notFound('产品不存在', { status: 404 });
    return ok(thingModelOf(params.id));
  }),
  mock(iotProductContract.importModel, ({ params, body, ok }) => {
    const productId = params.id;
    if (!mockIotProducts.some((p) => p.id === productId)) return notFound('产品不存在', { status: 404 });
    const now = mockDateTime();
    for (const arr of [mockIotProperties, mockIotServices, mockIotEvents]) {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].productId === productId) arr.splice(i, 1);
      }
    }
    for (const p of body.properties) {
      mockIotProperties.push({
        id: getNextIotModelItemId(), productId, identifier: p.identifier, name: p.name,
        dataType: p.dataType, accessMode: p.accessMode, unit: p.unit ?? null,
        minValue: p.minValue ?? null, maxValue: p.maxValue ?? null, enumOptions: p.enumOptions ?? null,
        featured: p.featured, anomalyEnabled: p.anomalyEnabled, sort: p.sort, description: p.description ?? null,
        createdAt: now, updatedAt: now,
      });
    }
    for (const s of body.services) {
      mockIotServices.push({
        id: getNextIotModelItemId(), productId, identifier: s.identifier, name: s.name,
        params: s.params, danger: s.danger, sort: s.sort,
        description: s.description ?? null, createdAt: now, updatedAt: now,
      });
    }
    for (const e of body.events) {
      mockIotEvents.push({
        id: getNextIotModelItemId(), productId, identifier: e.identifier, name: e.name,
        level: e.level, params: e.params, sort: e.sort,
        description: e.description ?? null, createdAt: now, updatedAt: now,
      });
    }
    return ok(thingModelOf(productId), '物模型已导入');
  }),
  mock(iotProductContract.createProperty, ({ params, body, ok }) => {
    const productId = params.id;
    if (mockIotProperties.some((x) => x.productId === productId && x.identifier === body.identifier)) {
      return badRequest(`属性标识符 "${body.identifier}" 已存在`, { status: 400 });
    }
    const now = mockDateTime();
    const row: IotProductProperty = {
      id: getNextIotModelItemId(), productId, identifier: body.identifier, name: body.name,
      dataType: body.dataType, accessMode: body.accessMode, unit: body.unit ?? null,
      minValue: body.minValue ?? null, maxValue: body.maxValue ?? null, enumOptions: body.enumOptions ?? null,
      featured: body.featured, anomalyEnabled: body.anomalyEnabled, sort: body.sort, description: body.description ?? null,
      createdAt: now, updatedAt: now,
    };
    mockIotProperties.push(row);
    return ok(row, '创建成功');
  }),
  mock(iotProductContract.updateProperty, ({ params, body, ok }) => {
    const row = mockIotProperties.find((x) => x.id === params.propertyId && x.productId === params.id);
    if (!row) return notFound('属性不存在', { status: 404 });
    Object.assign(row, body, { updatedAt: mockDateTime() });
    return ok(row, '更新成功');
  }),
  mock(iotProductContract.removeProperty, ({ params, ok }) => {
    const idx = mockIotProperties.findIndex((x) => x.id === params.propertyId && x.productId === params.id);
    if (idx === -1) return notFound('属性不存在', { status: 404 });
    mockIotProperties.splice(idx, 1);
    return ok(null, '删除成功');
  }),
  mock(iotProductContract.createService, ({ params, body, ok }) => {
    const productId = params.id;
    if (mockIotServices.some((x) => x.productId === productId && x.identifier === body.identifier)) {
      return badRequest(`服务标识符 "${body.identifier}" 已存在`, { status: 400 });
    }
    const now = mockDateTime();
    const row: IotProductService = {
      id: getNextIotModelItemId(), productId, identifier: body.identifier, name: body.name,
      params: body.params, danger: body.danger, sort: body.sort,
      description: body.description ?? null, createdAt: now, updatedAt: now,
    };
    mockIotServices.push(row);
    return ok(row, '创建成功');
  }),
  mock(iotProductContract.updateService, ({ params, body, ok }) => {
    const row = mockIotServices.find((x) => x.id === params.serviceId && x.productId === params.id);
    if (!row) return notFound('服务不存在', { status: 404 });
    Object.assign(row, body, { updatedAt: mockDateTime() });
    return ok(row, '更新成功');
  }),
  mock(iotProductContract.removeService, ({ params, ok }) => {
    const idx = mockIotServices.findIndex((x) => x.id === params.serviceId && x.productId === params.id);
    if (idx === -1) return notFound('服务不存在', { status: 404 });
    mockIotServices.splice(idx, 1);
    return ok(null, '删除成功');
  }),
  mock(iotProductContract.createEvent, ({ params, body, ok }) => {
    const productId = params.id;
    if (mockIotEvents.some((x) => x.productId === productId && x.identifier === body.identifier)) {
      return badRequest(`事件标识符 "${body.identifier}" 已存在`, { status: 400 });
    }
    const now = mockDateTime();
    const row: IotProductEvent = {
      id: getNextIotModelItemId(), productId, identifier: body.identifier, name: body.name,
      level: body.level, params: body.params, sort: body.sort,
      description: body.description ?? null, createdAt: now, updatedAt: now,
    };
    mockIotEvents.push(row);
    return ok(row, '创建成功');
  }),
  mock(iotProductContract.updateEvent, ({ params, body, ok }) => {
    const row = mockIotEvents.find((x) => x.id === params.eventId && x.productId === params.id);
    if (!row) return notFound('事件不存在', { status: 404 });
    Object.assign(row, body, { updatedAt: mockDateTime() });
    return ok(row, '更新成功');
  }),
  mock(iotProductContract.removeEvent, ({ params, ok }) => {
    const idx = mockIotEvents.findIndex((x) => x.id === params.eventId && x.productId === params.id);
    if (idx === -1) return notFound('事件不存在', { status: 404 });
    mockIotEvents.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ─── 产品详情 / 更新 / 删除（动态段在静态段之后）─────────────────────────────
  mock(iotProductContract.detail, ({ params, ok }) => {
    const product = requireItem(mockIotProducts, params.id, '产品不存在', { status: 404 });
    return ok(productWithCounts(product));
  }),
  mock(iotProductContract.update, ({ params, body, ok }) => {
    const product = updateItem(mockIotProducts, params.id, body, { notFoundMessage: '产品不存在', now: mockDateTime, init: { status: 404 } });
    return ok(productWithCounts(product), '更新成功');
  }),
  mock(iotProductContract.remove, ({ params, ok }) => {
    const product = requireItem(mockIotProducts, params.id, '产品不存在', { status: 404 });
    if (mockIotDevices.some((d) => d.productId === params.id)) return badRequest('产品下存在设备，无法删除', { status: 400 });
    mockIotProducts.splice(mockIotProducts.indexOf(product), 1);
    return ok(null, '删除成功');
  }),

  // ─── 设备分组 ────────────────────────────────────────────────────────────────
  mock(iotDeviceGroupContract.all, ({ ok }) =>
    ok(mockIotGroups.map((g) => ({ ...g, deviceCount: g.deviceIds.length })))),
  mock(iotDeviceGroupContract.list, ({ query, ok, paginate }) => {
    let list = mockIotGroups.map((g) => ({ ...g, deviceCount: g.deviceIds.length }));
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(g) => g.name, (g) => g.description]);
    return ok(paginate([...list].sort((a, b) => b.id - a.id)));
  }),
  mock(iotDeviceGroupContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const group = {
      id: getNextIotGroupId(), name: body.name, description: body.description ?? null,
      deviceCount: body.deviceIds.length, deviceIds: body.deviceIds,
      createdAt: now, updatedAt: now,
    };
    mockIotGroups.push(group);
    return ok(group, '创建成功');
  }),
  mock(iotDeviceGroupContract.detail, ({ params, ok }) => {
    const group = requireItem(mockIotGroups, params.id, '设备分组不存在', { status: 404 });
    return ok({ ...group, deviceCount: group.deviceIds.length });
  }),
  mock(iotDeviceGroupContract.update, ({ params, body, ok }) => {
    const group = requireItem(mockIotGroups, params.id, '设备分组不存在', { status: 404 });
    Object.assign(group, body, { updatedAt: mockDateTime() });
    return ok({ ...group, deviceCount: group.deviceIds.length }, '更新成功');
  }),
  mock(iotDeviceGroupContract.remove, ({ params, ok }) => {
    requireItem(mockIotGroups, params.id, '设备分组不存在', { status: 404 });
    removeByIds(mockIotGroups, [params.id]);
    return ok(null, '删除成功');
  }),

  // ─── 批量操作（Demo：同步逐台模拟，提交后任务在 async-tasks mock 中推进）─────
  mock(iotBatchContract.commands, ({ body, ok }) => {
    const ids = resolveBatchTargets(body.deviceIds, body.groupId);
    if (ids.size === 0) return badRequest('目标设备为空', { status: 400 });
    const now = mockDateTime();
    for (const deviceId of ids) {
      const device = mockIotDevices.find((d) => d.id === deviceId);
      if (!device || device.status !== 'enabled') continue;
      mockIotCommands.push({
        id: getNextIotCommandId(), deviceId, service: body.service, params: body.params ?? null,
        status: device.online ? 'delivered' : 'pending', expireAt: now,
        sentAt: device.online ? now : null, ackedAt: null, response: null, errorMsg: null, createdBy: 1, createdAt: now,
      });
    }
    return ok(
      completedBatchTask('iot-batch-command', `批量下发指令 ${body.service}（${ids.size} 台）`, ids.size),
      '批量任务已提交，可在任务中心查看进度',
    );
  }),
  mock(iotBatchContract.desired, ({ body, ok }) => {
    const ids = resolveBatchTargets(body.deviceIds, body.groupId);
    if (ids.size === 0) return badRequest('目标设备为空', { status: 400 });
    for (const deviceId of ids) {
      const shadow = getShadow(deviceId);
      Object.assign(shadow.desired, body.desired);
      shadow.desiredVersion += 1;
      shadow.desiredAt = mockDateTime();
    }
    return ok(
      completedBatchTask('iot-batch-desired', `批量设置期望属性（${ids.size} 台）`, ids.size),
      '批量任务已提交，可在任务中心查看进度',
    );
  }),

  // ─── 告警规则 ────────────────────────────────────────────────────────────────
  mock(iotAlarmRuleContract.list, ({ query, ok, paginate }) => {
    let list = [...mockIotAlarmRules];
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(r) => r.name]);
    if (query.productId) list = list.filter((r) => r.productId === query.productId);
    if (query.ruleType) list = list.filter((r) => r.ruleType === query.ruleType);
    if (query.status) list = list.filter((r) => r.status === query.status);
    return ok(paginate(list.sort((a, b) => b.id - a.id)));
  }),
  mock(iotAlarmRuleContract.create, ({ body, ok }) => {
    const product = mockIotProducts.find((p) => p.id === body.productId);
    if (!product) return badRequest('所属产品不存在', { status: 400 });
    const device = body.deviceId ? mockIotDevices.find((d) => d.id === body.deviceId) : null;
    const now = mockDateTime();
    const rule: IotAlarmRule = {
      id: getNextIotAlarmRuleId(),
      name: body.name,
      productId: body.productId,
      productName: product.name,
      deviceId: body.deviceId ?? null,
      deviceName: device?.name ?? null,
      ruleType: body.ruleType,
      propertyIdentifier: body.propertyIdentifier ?? null,
      operator: body.operator ?? null,
      threshold: body.threshold ?? null,
      consecutiveCount: body.consecutiveCount,
      offlineMinutes: body.offlineMinutes ?? null,
      eventIdentifier: body.eventIdentifier ?? null,
      level: body.level,
      notifyUserIds: body.notifyUserIds,
      escalateAfterMinutes: body.escalateAfterMinutes ?? null,
      escalateUserIds: body.escalateUserIds,
      status: body.status,
      createdAt: now,
      updatedAt: now,
    };
    mockIotAlarmRules.push(rule);
    return ok(rule, '创建成功');
  }),
  mock(iotAlarmRuleContract.update, ({ params, body, ok }) => {
    const rule = requireItem(mockIotAlarmRules, params.id, '告警规则不存在', { status: 404 });
    if (body.deviceId !== undefined) {
      rule.deviceName = body.deviceId ? (mockIotDevices.find((d) => d.id === body.deviceId)?.name ?? null) : null;
    }
    Object.assign(rule, body, { updatedAt: mockDateTime() });
    return ok(rule, '更新成功');
  }),
  mock(iotAlarmRuleContract.remove, ({ params, ok }) => {
    requireItem(mockIotAlarmRules, params.id, '告警规则不存在', { status: 404 });
    removeByIds(mockIotAlarmRules, [params.id]);
    return ok(null, '删除成功');
  }),

  // ─── 告警记录 ────────────────────────────────────────────────────────────────
  mock(iotAlarmContract.list, ({ query, ok, paginate }) => {
    let list = [...mockIotAlarms];
    if (query.keyword) {
      const keyword = query.keyword;
      list = list.filter((a) => a.ruleName.includes(keyword) || a.message.includes(keyword)
        || (a.deviceName ?? '').includes(keyword) || (a.deviceSn ?? '').includes(keyword));
    }
    if (query.status) list = list.filter((a) => a.status === query.status);
    if (query.level) list = list.filter((a) => a.level === query.level);
    if (query.ruleType) list = list.filter((a) => a.ruleType === query.ruleType);
    if (query.deviceId) list = list.filter((a) => a.deviceId === query.deviceId);
    return ok(paginate(list.sort((a, b) => b.id - a.id)));
  }),
  mock(iotAlarmContract.acknowledge, ({ params, ok }) => {
    const alarm = mockIotAlarms.find((a) => a.id === params.id);
    if (!alarm || alarm.status !== 'firing') return notFound('告警不存在或不处于告警中', { status: 404 });
    alarm.status = 'acknowledged';
    alarm.acknowledgedAt = mockDateTime();
    alarm.acknowledgedBy = 1;
    alarm.acknowledgedByName = '演示管理员';
    return ok(alarm, '已认领');
  }),
  mock(iotAlarmContract.resolve, ({ params, body, ok }) => {
    const alarm = mockIotAlarms.find((a) => a.id === params.id);
    if (!alarm || alarm.status === 'resolved') return notFound('告警不存在或已恢复', { status: 404 });
    alarm.status = 'resolved';
    alarm.resolvedAt = mockDateTime();
    alarm.resolvedBy = 1;
    alarm.resolvedByName = '演示管理员';
    alarm.resolveNote = body.note?.trim() || null;
    return ok(alarm, '告警已处理');
  }),

  // ─── 维护窗口 ────────────────────────────────────────────────────────────────
  mock(iotMaintenanceWindowContract.list, ({ query, ok, paginate }) => {
    let list = [...mockIotMaintenanceWindows];
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(w) => w.name]);
    return ok(paginate(list.sort((a, b) => b.id - a.id)));
  }),
  mock(iotMaintenanceWindowContract.create, ({ body, ok }) => {
    const win: IotMaintenanceWindow = {
      id: getNextIotMaintenanceWindowId(),
      name: body.name,
      productId: body.productId ?? null,
      productName: mockIotProducts.find((p) => p.id === body.productId)?.name ?? null,
      groupId: body.groupId ?? null,
      groupName: mockIotGroups.find((g) => g.id === body.groupId)?.name ?? null,
      deviceId: body.deviceId ?? null,
      deviceName: mockIotDevices.find((d) => d.id === body.deviceId)?.name ?? null,
      startAt: body.startAt,
      endAt: body.endAt,
      reason: body.reason ?? null,
      active: false,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockIotMaintenanceWindows.push(win);
    return ok(win, '创建成功');
  }),
  mock(iotMaintenanceWindowContract.update, ({ params, body, ok }) => {
    const win = updateItem(mockIotMaintenanceWindows, params.id, body, { notFoundMessage: '维护窗口不存在', now: mockDateTime, init: { status: 404 } });
    return ok(win, '更新成功');
  }),
  mock(iotMaintenanceWindowContract.remove, ({ params, ok }) => {
    requireItem(mockIotMaintenanceWindows, params.id, '维护窗口不存在', { status: 404 });
    removeByIds(mockIotMaintenanceWindows, [params.id]);
    return ok(null, '删除成功');
  }),

  // ─── 计划任务（/runs 静态段先于 /:id）───────────────────────────────────────
  mock(iotScheduleContract.runs, ({ query, ok, paginate }) => {
    let list = [...mockIotScheduleRuns];
    if (query.scheduleId) list = list.filter((r) => r.scheduleId === query.scheduleId);
    return ok(paginate(list.sort((a, b) => b.id - a.id)));
  }),
  mock(iotScheduleContract.list, ({ query, ok, paginate }) => {
    let list = [...mockIotSchedules];
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(s) => s.name]);
    if (query.productId) list = list.filter((s) => s.productId === query.productId);
    if (query.status) list = list.filter((s) => s.status === query.status);
    return ok(paginate(list.sort((a, b) => b.id - a.id)));
  }),
  mock(iotScheduleContract.create, ({ body, ok }) => {
    const product = requireItem(mockIotProducts, body.productId, '产品不存在', { status: 404 });
    const schedule: IotSchedule = {
      id: getNextIotScheduleId(),
      name: body.name,
      scheduleType: body.scheduleType,
      cronExpression: body.cronExpression ?? null,
      runAt: body.runAt ?? null,
      productId: product.id,
      productName: product.name,
      groupId: body.groupId ?? null,
      groupName: mockIotGroups.find((g) => g.id === body.groupId)?.name ?? null,
      deviceId: body.deviceId ?? null,
      deviceName: mockIotDevices.find((d) => d.id === body.deviceId)?.name ?? null,
      actionType: body.actionType,
      service: body.service ?? null,
      params: body.params ?? null,
      desired: body.desired ?? null,
      status: body.status,
      nextRunAt: null,
      lastRunAt: null,
      recentRunCount: 0,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockIotSchedules.push(schedule);
    return ok(schedule, '创建成功');
  }),
  mock(iotScheduleContract.update, ({ params, body, ok }) => {
    const schedule = requireItem(mockIotSchedules, params.id, '计划任务不存在', { status: 404 });
    Object.assign(schedule, body, { updatedAt: mockDateTime() });
    schedule.groupName = mockIotGroups.find((g) => g.id === schedule.groupId)?.name ?? null;
    schedule.deviceName = mockIotDevices.find((d) => d.id === schedule.deviceId)?.name ?? null;
    return ok(schedule, '更新成功');
  }),
  mock(iotScheduleContract.remove, ({ params, ok }) => {
    requireItem(mockIotSchedules, params.id, '计划任务不存在', { status: 404 });
    removeByIds(mockIotSchedules, [params.id]);
    return ok(null, '删除成功');
  }),

  // ─── 动态注册（/stats 与 /products 静态段先于 /:id）─────────────────────────
  mock(iotWhitelistContract.stats, ({ query, ok }) => {
    const list = query.productId ? mockIotWhitelist.filter((e) => e.productId === query.productId) : mockIotWhitelist;
    return ok({ total: list.length, used: list.filter((e) => e.used).length });
  }),
  mock(iotWhitelistContract.resetRegistrationSecret, ({ params, ok }) => {
    const product = requireItem(mockIotProducts, params.id, '产品不存在', { status: 404 });
    product.registrationEnabled = true;
    return ok({ registrationSecret: randomHex(32) }, '注册密钥已生成');
  }),
  mock(iotWhitelistContract.disableRegistration, ({ params, ok }) => {
    const product = requireItem(mockIotProducts, params.id, '产品不存在', { status: 404 });
    product.registrationEnabled = false;
    return ok(null, '已关闭动态注册');
  }),
  mock(iotWhitelistContract.list, ({ query, ok, paginate }) => {
    let list = [...mockIotWhitelist];
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(e) => e.sn, (e) => e.remark]);
    if (query.productId) list = list.filter((e) => e.productId === query.productId);
    if (query.used !== undefined) list = list.filter((e) => e.used === query.used);
    return ok(paginate(list.sort((a, b) => b.id - a.id)));
  }),
  mock(iotWhitelistContract.import, ({ body, ok }) => {
    const product = requireItem(mockIotProducts, body.productId, '产品不存在', { status: 404 });
    const existing = new Set(mockIotWhitelist.map((e) => e.sn));
    let inserted = 0;
    for (const sn of body.sns) {
      if (existing.has(sn)) continue;
      existing.add(sn);
      inserted += 1;
      mockIotWhitelist.push({
        id: getNextIotWhitelistId(),
        productId: product.id,
        productName: product.name,
        sn,
        used: false,
        usedAt: null,
        deviceId: null,
        deviceName: null,
        remark: body.remark?.trim() || null,
        createdAt: mockDateTime(),
      });
    }
    return ok({ total: body.sns.length, inserted, skipped: body.sns.length - inserted }, '导入完成');
  }),
  mock(iotWhitelistContract.remove, ({ params, ok }) => {
    const idx = mockIotWhitelist.findIndex((e) => e.id === params.id);
    if (idx === -1) return notFound('白名单条目不存在', { status: 404 });
    if (mockIotWhitelist[idx].used) return badRequest('已注册核销的条目不可删除', { status: 400 });
    mockIotWhitelist.splice(idx, 1);
    return ok(null, '已移除');
  }),

  // ─── 场景联动（/runs 静态段先于 /:id）───────────────────────────────────────
  mock(iotAutomationContract.runs, ({ query, ok, paginate }) => {
    let list = [...mockIotAutomationRuns];
    if (query.automationId) list = list.filter((r) => r.automationId === query.automationId);
    if (query.deviceId) list = list.filter((r) => r.deviceId === query.deviceId);
    if (query.success !== undefined) list = list.filter((r) => r.success === query.success);
    return ok(paginate(list.sort((a, b) => b.id - a.id)));
  }),
  mock(iotAutomationContract.list, ({ query, ok, paginate }) => {
    let list = [...mockIotAutomations];
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(a) => a.name]);
    if (query.productId) list = list.filter((a) => a.productId === query.productId);
    if (query.triggerType) list = list.filter((a) => a.triggerType === query.triggerType);
    if (query.status) list = list.filter((a) => a.status === query.status);
    return ok(paginate(list.sort((a, b) => b.id - a.id)));
  }),
  mock(iotAutomationContract.create, ({ body, ok }) => {
    const product = mockIotProducts.find((p) => p.id === body.productId);
    if (!product) return badRequest('指定的产品不存在', { status: 400 });
    const device = body.deviceId ? mockIotDevices.find((d) => d.id === body.deviceId) : null;
    const automation: IotAutomation = {
      id: getNextIotAutomationId(),
      name: body.name,
      productId: body.productId,
      productName: product.name,
      deviceId: body.deviceId ?? null,
      deviceName: device?.name ?? null,
      triggerType: body.triggerType,
      propertyIdentifier: body.triggerType === 'property' ? (body.propertyIdentifier ?? null) : null,
      operator: body.triggerType === 'property' ? (body.operator ?? null) : null,
      threshold: body.triggerType === 'property' ? (body.threshold ?? null) : null,
      eventIdentifier: body.triggerType === 'event' ? (body.eventIdentifier ?? null) : null,
      decisionRuleKey: body.decisionRuleKey ?? null,
      cooldownSeconds: body.cooldownSeconds,
      actions: body.actions,
      status: body.status,
      recentRunCount: 0,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockIotAutomations.push(automation);
    return ok(automation, '创建成功');
  }),
  mock(iotAutomationContract.update, ({ params, body, ok }) => {
    const automation = requireItem(mockIotAutomations, params.id, '联动规则不存在', { status: 404 });
    if (body.deviceId !== undefined) {
      const device = body.deviceId ? mockIotDevices.find((d) => d.id === body.deviceId) : null;
      automation.deviceId = body.deviceId ?? null;
      automation.deviceName = device?.name ?? null;
    }
    if (body.name !== undefined) automation.name = body.name;
    if (body.propertyIdentifier !== undefined) automation.propertyIdentifier = body.propertyIdentifier ?? null;
    if (body.operator !== undefined) automation.operator = body.operator ?? null;
    if (body.threshold !== undefined) automation.threshold = body.threshold ?? null;
    if (body.eventIdentifier !== undefined) automation.eventIdentifier = body.eventIdentifier ?? null;
    if (body.decisionRuleKey !== undefined) automation.decisionRuleKey = body.decisionRuleKey ?? null;
    if (body.cooldownSeconds !== undefined) automation.cooldownSeconds = body.cooldownSeconds;
    if (body.actions !== undefined) automation.actions = body.actions;
    if (body.status !== undefined) automation.status = body.status;
    automation.updatedAt = mockDateTime();
    return ok(automation, '更新成功');
  }),
  mock(iotAutomationContract.remove, ({ params, ok }) => {
    const idx = mockIotAutomations.findIndex((a) => a.id === params.id);
    if (idx < 0) return notFound('联动规则不存在', { status: 404 });
    mockIotAutomations.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ─── 数据流转（/logs 静态段先于 /:id）───────────────────────────────────────
  mock(iotForwardRuleContract.logs, ({ query, ok, paginate }) => {
    let list = [...mockIotForwardLogs];
    if (query.ruleId) list = list.filter((l) => l.ruleId === query.ruleId);
    if (query.status) list = list.filter((l) => l.status === query.status);
    return ok(paginate(list.sort((a, b) => b.id - a.id)));
  }),
  mock(iotForwardRuleContract.list, ({ query, ok, paginate }) => {
    let list = [...mockIotForwardRules];
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(r) => r.name]);
    if (query.source) list = list.filter((r) => r.source === query.source);
    if (query.status) list = list.filter((r) => r.status === query.status);
    return ok(paginate(list.sort((a, b) => b.id - a.id)));
  }),
  mock(iotForwardRuleContract.create, ({ body, ok }) => {
    const product = body.productId ? mockIotProducts.find((p) => p.id === body.productId) : null;
    const group = body.groupId ? mockIotGroups.find((g) => g.id === body.groupId) : null;
    const rule: IotForwardRule = {
      id: getNextIotForwardRuleId(),
      name: body.name,
      source: body.source,
      productId: body.productId ?? null,
      productName: product?.name ?? null,
      groupId: body.groupId ?? null,
      groupName: group?.name ?? null,
      url: body.url,
      hasSecret: !!body.secret,
      headers: body.headers ?? null,
      status: body.status,
      consecutiveFailures: 0,
      autoDisabledAt: null,
      recentDeliveryCount: 0,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockIotForwardRules.push(rule);
    return ok(rule, '创建成功');
  }),
  mock(iotForwardRuleContract.update, ({ params, body, ok }) => {
    const rule = requireItem(mockIotForwardRules, params.id, '流转规则不存在', { status: 404 });
    if (body.name !== undefined) rule.name = body.name;
    if (body.productId !== undefined) {
      rule.productId = body.productId ?? null;
      rule.productName = body.productId ? (mockIotProducts.find((p) => p.id === body.productId)?.name ?? null) : null;
    }
    if (body.groupId !== undefined) {
      rule.groupId = body.groupId ?? null;
      rule.groupName = body.groupId ? (mockIotGroups.find((g) => g.id === body.groupId)?.name ?? null) : null;
    }
    if (body.url !== undefined) rule.url = body.url;
    if (body.secret !== undefined && body.secret) rule.hasSecret = true;
    if (body.headers !== undefined) rule.headers = body.headers ?? null;
    if (body.status !== undefined) {
      rule.status = body.status;
      rule.consecutiveFailures = 0;
      rule.autoDisabledAt = null;
    }
    rule.updatedAt = mockDateTime();
    return ok(rule, '更新成功');
  }),
  mock(iotForwardRuleContract.remove, ({ params, ok }) => {
    const idx = mockIotForwardRules.findIndex((r) => r.id === params.id);
    if (idx < 0) return notFound('流转规则不存在', { status: 404 });
    mockIotForwardRules.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ─── 设备（静态段 batch 先于 /:id）──────────────────────────────────────────
  mock(iotDeviceContract.removeBatch, ({ body, ok }) => {
    removeByIds(mockIotDevices, body.ids);
    return ok(null, `已删除 ${body.ids.length} 台设备`);
  }),
  mock(iotDeviceContract.list, ({ query, ok, paginate }) => {
    let list = mockIotDevices.map(withGroupInfo);
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(d) => d.sn, (d) => d.name]);
    if (query.status) list = list.filter((d) => d.status === query.status);
    if (query.productId) list = list.filter((d) => d.productId === query.productId);
    if (query.groupId) list = list.filter((d) => d.groupIds.includes(query.groupId!));
    if (query.nodeType) list = list.filter((d) => d.nodeType === query.nodeType);
    if (query.gatewayId) list = list.filter((d) => d.gatewayId === query.gatewayId);
    return ok(paginate(list.sort((a, b) => b.id - a.id)));
  }),

  // ─── 设备子资源 ──────────────────────────────────────────────────────────────
  mock(iotDeviceContract.telemetryAgg, ({ params, query, ok }) =>
    ok(buildMockTelemetryAgg(params.id, query.property, query.days ?? 7))),
  mock(iotDeviceContract.telemetry, ({ params, query, ok }) => ok(buildMockTelemetry(params.id, query.days ?? 1))),
  mock(iotDeviceContract.clearTelemetry, ({ params, ok }) => {
    const shadow = getShadow(params.id);
    shadow.reported = {};
    shadow.reportedAt = null;
    return ok(null, '已清空 48 条遥测数据');
  }),
  mock(iotDeviceContract.shadow, ({ params, ok }) => {
    if (!mockIotDevices.some((d) => d.id === params.id)) return notFound('设备不存在', { status: 404 });
    return ok({ ...getShadow(params.id), updatedAt: mockDateTime() });
  }),
  mock(iotDeviceContract.setDesired, ({ params, body, ok }) => {
    const device = requireItem(mockIotDevices, params.id, '设备不存在', { status: 404 });
    const props = mockIotProperties.filter((p) => p.productId === device.productId);
    for (const key of Object.keys(body.desired)) {
      const prop = props.find((p) => p.identifier === key);
      if (!prop) return badRequest(`属性 ${key} 未在物模型中声明`, { status: 400 });
      if (prop.accessMode !== 'rw') return badRequest(`属性 ${key} 为只读，不可下发`, { status: 400 });
    }
    const shadow = getShadow(params.id);
    Object.assign(shadow.desired, body.desired);
    shadow.desiredVersion += 1;
    shadow.desiredAt = mockDateTime();
    return ok({ ...shadow }, '期望属性已下发，设备确认后自动收敛');
  }),
  mock(iotDeviceContract.clearDesired, ({ params, ok }) => {
    const shadow = getShadow(params.id);
    shadow.desired = {};
    shadow.desiredVersion += 1;
    shadow.desiredAt = mockDateTime();
    return ok({ ...shadow }, '期望属性已清空');
  }),
  mock(iotDeviceContract.events, ({ params, query, ok, paginate }) => {
    let list = mockIotDeviceEvents.filter((e) => e.deviceId === params.id);
    if (query.kind) list = list.filter((e) => e.kind === query.kind);
    if (query.level) list = list.filter((e) => e.level === query.level);
    return ok(paginate([...list].sort((a, b) => b.id - a.id)));
  }),
  mock(iotDeviceContract.logs, ({ params, query, ok, paginate }) => {
    let list = mockIotDeviceLogs.filter((l) => l.deviceId === params.id);
    if (query.level) list = list.filter((l) => l.level === query.level);
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(l) => l.content]);
    return ok(paginate([...list].sort((a, b) => b.id - a.id)));
  }),
  mock(iotDeviceContract.topology, ({ params, ok }) => {
    const gateway = requireItem(mockIotDevices, params.id, '设备不存在', { status: 404 });
    if (gateway.nodeType !== 'gateway') return badRequest('该设备不是网关，无拓扑视图', { status: 400 });
    const children = mockIotDevices.filter((d) => d.gatewayId === gateway.id);
    return ok({
      gateway: { id: gateway.id, sn: gateway.sn, name: gateway.name, online: gateway.online },
      children: children.map((c) => ({
        id: c.id, sn: c.sn, name: c.name, status: c.status, online: c.online,
        firingAlarmCount: mockIotAlarms.filter((a) => a.deviceId === c.id && a.status === 'firing').length,
        lastSeenAt: c.lastSeenAt,
      })),
    });
  }),
  mock(iotDeviceContract.listCommands, ({ params, ok, paginate }) => {
    const list = mockIotCommands.filter((c) => c.deviceId === params.id);
    return ok(paginate([...list].sort((a, b) => b.id - a.id)));
  }),
  mock(iotDeviceContract.sendCommand, ({ params, body, ok }) => {
    const device = requireItem(mockIotDevices, params.id, '设备不存在', { status: 404 });
    if (device.status !== 'enabled') return badRequest('设备已禁用，无法下发指令', { status: 400 });
    if (!mockIotServices.some((s) => s.productId === device.productId && s.identifier === body.service)) {
      return badRequest(`服务 ${body.service} 未在物模型中声明`, { status: 400 });
    }
    const now = mockDateTime();
    const command = {
      id: getNextIotCommandId(),
      deviceId: params.id,
      service: body.service,
      params: body.params ?? null,
      status: device.online ? ('delivered' as const) : ('pending' as const),
      expireAt: now,
      sentAt: device.online ? now : null,
      ackedAt: null,
      response: null,
      errorMsg: null,
      createdBy: 1,
      createdAt: now,
    };
    mockIotCommands.push(command);
    return ok(command, device.online ? '指令已实时送达设备' : '设备离线，指令将在上线后送达');
  }),
  mock(iotDeviceContract.resetSecret, ({ params, ok }) => {
    const device = requireItem(mockIotDevices, params.id, '设备不存在', { status: 404 });
    device.secret = randomHex(48);
    device.updatedAt = mockDateTime();
    return ok(withGroupInfo(device), '密钥已重置，请更新设备侧配置');
  }),

  // ─── 设备详情 / 创建 / 更新 / 删除 ──────────────────────────────────────────
  mock(iotDeviceContract.detail, ({ params, ok }) => {
    const device = requireItem(mockIotDevices, params.id, '设备不存在', { status: 404 });
    return ok(withGroupInfo(device));
  }),
  mock(iotDeviceContract.create, ({ body, ok }) => {
    const product = mockIotProducts.find((p) => p.id === body.productId);
    if (!product) return badRequest('所属产品不存在', { status: 400 });
    if (body.sn && mockIotDevices.some((d) => d.sn === body.sn)) return badRequest('SN 已存在', { status: 400 });
    const now = mockDateTime();
    const gatewayId = body.nodeType === 'sub' ? (body.gatewayId ?? null) : null;
    const device: IotDevice = {
      id: getNextIotDeviceId(),
      sn: body.sn || `SN-${randomHex(16).toUpperCase()}`,
      secret: randomHex(48),
      productId: product.id,
      productName: product.name,
      name: body.name,
      status: body.status,
      nodeType: body.nodeType,
      gatewayId,
      gatewayName: gatewayId ? (mockIotDevices.find((d) => d.id === gatewayId)?.name ?? null) : null,
      subDeviceCount: 0,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      address: body.address ?? null,
      online: false,
      firmwareVersion: body.firmwareVersion ?? null,
      activatedAt: null,
      lastSeenAt: null,
      reported: null,
      desired: {},
      groupIds: [],
      groupNames: [],
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockIotDevices.push(device);
    for (const groupId of body.groupIds ?? []) {
      const group = mockIotGroups.find((g) => g.id === groupId);
      if (group) group.deviceIds = [...group.deviceIds, device.id];
    }
    // 创建影子占位
    getShadow(device.id);
    return ok(withGroupInfo(device), '创建成功');
  }),
  mock(iotDeviceContract.update, ({ params, body, ok }) => {
    const device = requireItem(mockIotDevices, params.id, '设备不存在', { status: 404 });
    if (body.productId && body.productId !== device.productId) {
      const product = mockIotProducts.find((p) => p.id === body.productId);
      if (!product) return badRequest('所属产品不存在', { status: 400 });
      device.productName = product.name;
    }
    const { groupIds, ...rest } = body;
    Object.assign(device, rest, { updatedAt: mockDateTime() });
    if (groupIds !== undefined) {
      for (const group of mockIotGroups) {
        const set = new Set(group.deviceIds);
        if (groupIds.includes(group.id)) set.add(device.id);
        else set.delete(device.id);
        group.deviceIds = [...set];
      }
    }
    return ok(withGroupInfo(device), '更新成功');
  }),
  mock(iotDeviceContract.remove, ({ params, ok }) => {
    requireItem(mockIotDevices, params.id, '设备不存在', { status: 404 });
    removeByIds(mockIotDevices, [params.id]);
    return ok(null, '删除成功');
  }),
];
