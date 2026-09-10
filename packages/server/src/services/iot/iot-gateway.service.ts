/**
 * IoT 设备 WS 网关连接管理。
 *
 * 连接语义：握手验签通过并 onOpen 注册 = 在线（写 Redis TTL），
 * 断开 = 离线（删 Redis 键；HTTP 心跳设备不受影响，键会被其心跳重建）。
 *
 * 连接表是进程内存。指令 / 期望属性 / OTA 帧先尝试本地投递；本进程没有该设备的连接时把帧发布到
 * ws-fanout（`device` 信封），持有连接的 api 进程投递后按 ack 回写送达状态（iot-delivery-ack.ts）。
 * 因此推送函数的返回值只表示「本地已送达」：false 既可能是设备离线，也可能是连接在别的进程上——
 * 调用方一律保持 pending，由持有连接的进程或设备心跳收敛状态。
 */
import type { WSContext } from 'hono/ws';
import type { IotCommandPayload, IotDesiredPayload, IotOtaPayload } from '@zenith/shared/iot';
import { IOT_WS_FRAME_TYPES } from '@zenith/shared/iot';
import logger from '../../lib/logger';
import { onWsFanout, publishWsFanout } from '../../lib/ws-fanout';
import { acknowledgeDeviceDelivery } from './iot-delivery-ack';

const connections = new Map<string, WSContext>();

export function registerDeviceConnection(sn: string, ws: WSContext): void {
  // 同 SN 重复连接：踢掉旧连接，保留最新（设备重连场景）
  const existing = connections.get(sn);
  if (existing && existing !== ws) {
    try {
      existing.close(4000, 'Replaced by new connection');
    } catch { /* 旧连接可能已断 */ }
  }
  connections.set(sn, ws);
}

export function removeDeviceConnection(sn: string, ws: WSContext): void {
  // 仅当映射还指向本连接时才移除，避免重连竞态误删新连接
  if (connections.get(sn) === ws) connections.delete(sn);
}

/** 设备是否连接在本进程（集群范围的在线态见 iot-access.service 的 Redis 在线键） */
export function isDeviceConnected(sn: string): boolean {
  return connections.has(sn);
}

/** 向本进程持有的设备连接写一帧；无连接 / 发送异常返回 false */
function deliverFrameLocal(sn: string, frame: string, label: string): boolean {
  const ws = connections.get(sn);
  if (!ws) return false;
  try {
    ws.send(frame);
    return true;
  } catch (err) {
    logger.warn(`[iot-gateway] ${label}推送失败 sn=${sn}: ${(err as Error).message}`);
    connections.delete(sn);
    return false;
  }
}

onWsFanout('device', async (e) => {
  if (deliverFrameLocal(e.target, e.frame, '跨节点') && e.ack) await acknowledgeDeviceDelivery(e.ack);
});

/** 向设备推送指令帧；返回本地是否送达（未送达时调用方保持 pending，跨节点送达由持有连接的进程回写） */
export async function pushCommandToDevice(sn: string, payload: IotCommandPayload): Promise<boolean> {
  const frame = JSON.stringify({ type: IOT_WS_FRAME_TYPES.commandExec, payload });
  if (deliverFrameLocal(sn, frame, '指令')) return true;
  publishWsFanout({ kind: 'device', target: sn, frame, ack: { kind: 'command', commandId: payload.commandId } });
  return false;
}

/** 向设备推送期望属性帧；未本地送达时转发（HTTP 设备靠心跳响应捎带） */
export function pushDesiredToDevice(sn: string, payload: IotDesiredPayload): boolean {
  const frame = JSON.stringify({ type: IOT_WS_FRAME_TYPES.shadowDesired, payload });
  if (deliverFrameLocal(sn, frame, '期望属性')) return true;
  publishWsFanout({ kind: 'device', target: sn, frame });
  return false;
}

/** 向设备推送 OTA 升级帧；返回本地是否送达（离线设备靠心跳捎带，跨节点送达按 ack 回写 notified） */
export function pushOtaToDevice(sn: string, payload: IotOtaPayload, ack?: { taskId: number; deviceId: number }): boolean {
  const frame = JSON.stringify({ type: IOT_WS_FRAME_TYPES.otaUpgrade, payload });
  if (deliverFrameLocal(sn, frame, 'OTA')) return true;
  publishWsFanout({ kind: 'device', target: sn, frame, ack: ack ? { kind: 'ota', ...ack } : undefined });
  return false;
}

export function getConnectedDeviceCount(): number {
  return connections.size;
}
