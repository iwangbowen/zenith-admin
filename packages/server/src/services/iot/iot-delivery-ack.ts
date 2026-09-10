/**
 * 设备帧跨节点送达后的状态回写。
 *
 * 指令 / OTA 帧由业务 service 发出，但持有设备 WS 连接的可能是另一个 api 进程：
 * 源进程只能把帧发布到 fan-out，无法得知是否送达；持有连接的进程投递成功后按信封里的 ack 回写。
 * 独立成模块是为了让 iot-gateway 能调用而不反向依赖 iot-telemetry / iot-ota（它们依赖网关）。
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { iotCommands, iotOtaTaskDevices } from '../../db/schema';
import type { DeviceDeliveryAck } from '../../lib/ws-fanout';

export async function acknowledgeDeviceDelivery(ack: DeviceDeliveryAck): Promise<void> {
  if (ack.kind === 'command') {
    // 只推进仍为 pending 的记录：设备可能已经通过 HTTP 拉取或回执
    await db.update(iotCommands)
      .set({ status: 'delivered', sentAt: new Date() })
      .where(and(eq(iotCommands.id, ack.commandId), eq(iotCommands.status, 'pending')));
    return;
  }
  await db.update(iotOtaTaskDevices)
    .set({ status: 'notified', notifiedAt: new Date() })
    .where(and(
      eq(iotOtaTaskDevices.taskId, ack.taskId),
      eq(iotOtaTaskDevices.deviceId, ack.deviceId),
      eq(iotOtaTaskDevices.status, 'pending'),
    ));
}
