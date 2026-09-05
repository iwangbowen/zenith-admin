/**
 * IoT 设备侧接入（设备 HMAC 签名鉴权，无管理端 token）。
 *
 * 签名基于原始请求体文本：鉴权中间件先读原文验签，契约校验器再从同一缓存解析 JSON。
 * 全局 pathBoundRateLimit 已覆盖全部 API，平台「限流规则」按本域路径前缀配置即可精细限流。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { IOT_SIGN_HEADER, IOT_TIMESTAMP_HEADER, iotIngestContract } from '@zenith/shared/iot';
import { captureIotRawBody, iotDeviceHeaderAuth, iotDeviceQueryAuth } from '../../middleware/iot-device-auth';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { touchDevice } from '../../services/iot/iot-access.service';
import { ingestTelemetry, pullPendingCommands, ackIotCommand } from '../../services/iot/iot-telemetry.service';
import { ingestIotDeviceEvents } from '../../services/iot/iot-events.service';
import { ingestIotDeviceLogs } from '../../services/iot/iot-device-logs.service';
import { ingestGatewayBatch, ingestGatewayEvent } from '../../services/iot/iot-topology.service';
import { getIotDesiredPayload } from '../../services/iot/iot-shadow.service';
import { ensureOtaDownloadAllowed, getPendingOtaPayload, reportIotOtaProgress } from '../../services/iot/iot-ota.service';
import { getFileAccessUrl } from '../../services/files/files.service';

const ingestRouter = new OpenAPIHono({ defaultHook: validationHook });

/** 批量上报遥测（自动续期在线态） */
const telemetryRoute = defineContractRoute(iotIngestContract.telemetry, {
  middleware: [iotDeviceHeaderAuth],
  handler: async (c) => {
    const count = await ingestTelemetry(c.get('iotDevice'), c.req.valid('json'));
    return c.json(okBody({ accepted: count }), 200);
  },
});

/** 批量上报设备事件（按物模型解析级别，触发事件类告警） */
const eventsRoute = defineContractRoute(iotIngestContract.events, {
  middleware: [iotDeviceHeaderAuth],
  handler: async (c) => {
    const device = c.get('iotDevice');
    const count = await ingestIotDeviceEvents(device, c.req.valid('json'));
    await touchDevice(device);
    return c.json(okBody({ accepted: count }), 200);
  },
});

/** 批量上报设备运行日志 */
const logsRoute = defineContractRoute(iotIngestContract.logs, {
  middleware: [iotDeviceHeaderAuth],
  handler: async (c) => {
    const device = c.get('iotDevice');
    const count = await ingestIotDeviceLogs(device, c.req.valid('json'));
    await touchDevice(device);
    return c.json(okBody({ accepted: count }), 200);
  },
});

/** 网关批量代理子设备遥测（网关身份签名，子设备免密） */
const gatewayTelemetryRoute = defineContractRoute(iotIngestContract.gatewayTelemetry, {
  middleware: [iotDeviceHeaderAuth],
  handler: async (c) => {
    const device = c.get('iotDevice');
    const result = await ingestGatewayBatch(device, c.req.valid('json'));
    await touchDevice(device);
    return c.json(okBody(result), 200);
  },
});

/** 网关代理子设备事件 */
const gatewayEventsRoute = defineContractRoute(iotIngestContract.gatewayEvents, {
  middleware: [iotDeviceHeaderAuth],
  handler: async (c) => {
    const device = c.get('iotDevice');
    const accepted = await ingestGatewayEvent(device, c.req.valid('json'));
    await touchDevice(device);
    return c.json(okBody({ accepted: accepted ? 1 : 0, rejected: accepted ? 0 : 1 }), 200);
  },
});

/** 心跳（body 可为空对象），响应携带待执行指令、期望属性与待升级固件 */
const heartbeatRoute = defineContractRoute(iotIngestContract.heartbeat, {
  middleware: [iotDeviceHeaderAuth],
  handler: async (c) => {
    const device = c.get('iotDevice');
    await touchDevice(device);
    const [commands, desired, ota] = await Promise.all([
      pullPendingCommands(device),
      getIotDesiredPayload(device),
      getPendingOtaPayload(device),
    ]);
    return c.json(okBody({ commands, desired, ota }), 200);
  },
});

/** OTA 进度回报（downloading/installing 带进度，succeeded/failed 终态） */
const otaProgressRoute = defineContractRoute(iotIngestContract.otaProgress, {
  middleware: [iotDeviceHeaderAuth],
  handler: async (c) => {
    await reportIotOtaProgress(c.get('iotDevice'), c.req.valid('json'));
    return c.json(okBody(null, '进度已记录'), 200);
  },
});

/** 固件下载：query 携带 sn/ts/sign（对空串签名），302 跳转存储直链 */
const otaFirmwareRoute = defineContractRoute(iotIngestContract.otaFirmware, {
  middleware: [iotDeviceQueryAuth],
  responses: { 302: { description: '重定向到固件文件访问地址' } },
  handler: async (c) => {
    const { taskId } = c.req.valid('query');
    const fileId = await ensureOtaDownloadAllowed(c.get('iotDevice'), taskId);
    const { url } = await getFileAccessUrl(fileId, 'download');
    return c.redirect(url, 302);
  },
});

/** 指令执行回执 */
const commandAckRoute = defineContractRoute(iotIngestContract.commandAck, {
  middleware: [iotDeviceHeaderAuth],
  handler: async (c) => {
    const { commandId } = c.req.valid('param');
    await ackIotCommand(c.get('iotDevice'), commandId, c.req.valid('json'));
    return c.json(okBody(null, '回执已记录'), 200);
  },
});

/** 一型一密动态注册（产品注册密钥签名，白名单核销后返回设备密钥） */
const registerRoute = defineContractRoute(iotIngestContract.register, {
  middleware: [captureIotRawBody],
  handler: async (c) => {
    const { registerIotDevice } = await import('../../services/iot/iot-register.service');
    const result = await registerIotDevice(c.req.valid('json'), {
      ts: c.req.header(IOT_TIMESTAMP_HEADER),
      sign: c.req.header(IOT_SIGN_HEADER),
      rawBody: c.get('iotRawBody'),
    });
    return c.json(okBody(result, '注册成功，请持久化设备密钥'), 200);
  },
});

ingestRouter.openapiRoutes([
  telemetryRoute,
  eventsRoute,
  logsRoute,
  gatewayTelemetryRoute,
  gatewayEventsRoute,
  heartbeatRoute,
  otaProgressRoute,
  otaFirmwareRoute,
  commandAckRoute,
  registerRoute,
] as const);

export default ingestRouter;
