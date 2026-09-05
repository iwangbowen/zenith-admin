/**
 * IoT 设备 WebSocket 网关。
 *
 * 握手：query 携带 sn/ts/sign（body 为空串的 HMAC 签名），验签失败 4001 关闭。
 * 连接即在线；上线补推全部 pending 指令与未确认期望属性；断开即离线（HTTP 心跳设备可重建在线态）。
 *
 * 帧协议（JSON）：
 *   设备 → 服务端：{type:'heartbeat'} | {type:'telemetry',payload:IotTelemetryIngestInput}
 *                  | {type:'event',payload:IotEventIngestInput}
 *                  | {type:'command:ack',payload:{commandId,success,response?,errorMsg?}}
 *                  | {type:'ota:progress',payload:{taskId,status,progress?,errorMsg?}}
 *   服务端 → 设备：{type:'command:exec',payload:IotCommandPayload} | {type:'heartbeat:ack'}
 *                  | {type:'shadow:desired',payload:IotDesiredPayload}
 *                  | {type:'ota:upgrade',payload:IotOtaPayload}
 */
import { Hono } from 'hono';
import type { UpgradeWebSocket, WSContext } from 'hono/ws';
import * as z from 'zod';
import {
  IOT_WS_FRAME_TYPES, iotTelemetryIngestSchema, iotCommandAckSchema, iotEventIngestSchema,
  iotGatewayBatchSchema, iotGatewayEventSchema, iotLogIngestSchema, iotOtaProgressSchema,
} from '@zenith/shared/iot';
import type { IotDeviceRow } from '../../db/schema';
import { authenticateDevice, markDeviceOnline, markDeviceOffline, touchDevice } from '../../services/iot/iot-access.service';
import {
  ingestTelemetry, ackIotCommand, getPendingCommandPayloads, markCommandsDelivered,
} from '../../services/iot/iot-telemetry.service';
import { ingestIotDeviceEvents } from '../../services/iot/iot-events.service';
import { ingestIotDeviceLogs } from '../../services/iot/iot-device-logs.service';
import { ingestGatewayBatch, ingestGatewayEvent } from '../../services/iot/iot-topology.service';
import { getIotDesiredPayload } from '../../services/iot/iot-shadow.service';
import { getPendingOtaPayload, reportIotOtaProgress } from '../../services/iot/iot-ota.service';
import { registerDeviceConnection, removeDeviceConnection } from '../../services/iot/iot-gateway.service';
import logger from '../../lib/logger';

// 设备长连接的帧解析是持续热点（遥测/网关批量每秒到达），全部 AOT 预编译换事件循环余量
// （在 server 使用点编译而非 shared 定义点，避免把 zod 编译器带进 web 包；strict 防未来改动静默退化）
const telemetryFrameSchema = z.compile(iotTelemetryIngestSchema, { strict: true });
const eventFrameSchema = z.compile(iotEventIngestSchema, { strict: true });
const logFrameSchema = z.compile(iotLogIngestSchema, { strict: true });
const gatewayBatchFrameSchema = z.compile(iotGatewayBatchSchema, { strict: true });
const gatewayEventFrameSchema = z.compile(iotGatewayEventSchema, { strict: true });
const otaProgressFrameSchema = z.compile(iotOtaProgressSchema, { strict: true });
const ackFrameSchema = z.compile(iotCommandAckSchema.extend({ commandId: z.number().int().positive() }), { strict: true });

/**
 * 单连接待处理帧上限。WS 没有逐帧回执，设备可以不顾服务端处理速度持续推帧；
 * 不设上限时几百台设备同时超速上报会让在途处理无界堆积（实测事件循环卡死两分钟）。
 * 超出即丢弃新帧并记日志——遥测本就是流式数据，丢帧优于拖垮整个接入面。
 */
const WS_MAX_BACKLOG_PER_CONNECTION = 100;

async function handleDeviceFrame(device: IotDeviceRow, ws: WSContext, data: unknown): Promise<void> {
  const frame = JSON.parse(typeof data === 'string' ? data : '') as { type?: string; payload?: unknown };
  switch (frame?.type) {
    case IOT_WS_FRAME_TYPES.heartbeat: {
      await markDeviceOnline(device.id);
      ws.send(JSON.stringify({ type: IOT_WS_FRAME_TYPES.heartbeatAck }));
      break;
    }
    case IOT_WS_FRAME_TYPES.telemetry: {
      const parsed = telemetryFrameSchema.safeParse(frame.payload);
      if (parsed.success) await ingestTelemetry(device, parsed.data);
      break;
    }
    case IOT_WS_FRAME_TYPES.event: {
      const parsed = eventFrameSchema.safeParse(frame.payload);
      if (parsed.success) await ingestIotDeviceEvents(device, parsed.data);
      break;
    }
    case IOT_WS_FRAME_TYPES.log: {
      const parsed = logFrameSchema.safeParse(frame.payload);
      if (parsed.success) await ingestIotDeviceLogs(device, parsed.data);
      break;
    }
    case IOT_WS_FRAME_TYPES.gatewayBatch: {
      const parsed = gatewayBatchFrameSchema.safeParse(frame.payload);
      if (parsed.success) await ingestGatewayBatch(device, parsed.data);
      break;
    }
    case IOT_WS_FRAME_TYPES.gatewayEvent: {
      const parsed = gatewayEventFrameSchema.safeParse(frame.payload);
      if (parsed.success) await ingestGatewayEvent(device, parsed.data);
      break;
    }
    case IOT_WS_FRAME_TYPES.otaProgress: {
      const parsed = otaProgressFrameSchema.safeParse(frame.payload);
      if (parsed.success) await reportIotOtaProgress(device, parsed.data).catch(() => { /* 任务已结束等业务性拒绝，忽略 */ });
      break;
    }
    case IOT_WS_FRAME_TYPES.commandAck: {
      const parsed = ackFrameSchema.safeParse(frame.payload);
      if (parsed.success) {
        const { commandId, ...ack } = parsed.data;
        await ackIotCommand(device, commandId, ack);
      }
      break;
    }
    default:
      break;
  }
}

export function createIotWsRoute(upgradeWebSocket: UpgradeWebSocket) {
  const wsApp = new Hono();

  wsApp.get(
    '/',
    upgradeWebSocket(async (c) => {
      let device: IotDeviceRow | null = null;
      try {
        device = await authenticateDevice(c.req.query('sn'), c.req.query('ts'), c.req.query('sign'), '');
      } catch {
        device = null;
      }
      // 单连接帧串行处理：保住同一设备的点序（阈值告警连续计数依赖它），并给积压设上限
      let chain: Promise<void> = Promise.resolve();
      let backlog = 0;
      let dropped = 0;

      return {
        onOpen(_evt, ws) {
          if (!device) {
            ws.close(4001, 'Unauthorized');
            return;
          }
          const d = device;
          registerDeviceConnection(d.sn, ws);
          // 在线登记 + 上线补推 pending 指令（推完统一标 delivered）、未确认期望属性与待升级固件
          void (async () => {
            await touchDevice(d);
            const [pendings, desired, ota] = await Promise.all([
              getPendingCommandPayloads(d.id),
              getIotDesiredPayload(d),
              getPendingOtaPayload(d),
            ]);
            if (pendings.length > 0) {
              for (const payload of pendings) {
                ws.send(JSON.stringify({ type: IOT_WS_FRAME_TYPES.commandExec, payload }));
              }
              await markCommandsDelivered(pendings.map((p) => p.commandId));
            }
            if (desired) {
              ws.send(JSON.stringify({ type: IOT_WS_FRAME_TYPES.shadowDesired, payload: desired }));
            }
            if (ota) {
              ws.send(JSON.stringify({ type: IOT_WS_FRAME_TYPES.otaUpgrade, payload: ota }));
            }
          })().catch((err) => {
            logger.warn(`[iot-ws] 上线处理失败 sn=${d.sn}: ${(err as Error).message}`);
          });
        },
        onMessage(evt, ws) {
          if (!device) return;
          const d = device;
          if (backlog >= WS_MAX_BACKLOG_PER_CONNECTION) {
            dropped += 1;
            if (dropped === 1 || dropped % 1000 === 0) {
              logger.warn(`[iot-ws] sn=${d.sn} 帧积压超过 ${WS_MAX_BACKLOG_PER_CONNECTION}，已丢弃 ${dropped} 帧（设备上报速率超出服务端处理能力）`);
            }
            return;
          }
          backlog += 1;
          chain = chain
            .then(() => handleDeviceFrame(d, ws, evt.data))
            .catch(() => { /* 忽略畸形帧与业务性拒绝 */ })
            .finally(() => { backlog -= 1; });
        },
        onClose(_evt, ws) {
          if (!device) return;
          removeDeviceConnection(device.sn, ws);
          void markDeviceOffline(device.id);
        },
        onError() {
          // 连接级错误由 WS 适配器处理，onClose 兜底清理
        },
      };
    }),
  );

  return wsApp;
}
