import * as z from 'zod';
import { entityStatusSchema } from '../../core/api-schemas';
import { iotMetricsSchema } from './devices';

/**
 * 开放 API 视角的设备（对外以 SN 寻址，不暴露内部 id、secret 与租户信息）。
 * 由开放平台网关的 IoT 子契约（`openIotContract`）引用。
 */
export const openIotDeviceSchema = z.object({
  sn: z.string(),
  name: z.string(),
  productId: z.int(),
  productName: z.string().nullable(),
  status: entityStatusSchema,
  online: z.boolean(),
  firmwareVersion: z.string().nullable(),
  activatedAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
}).meta({ id: 'OpenIotDevice' });

export type OpenIotDevice = z.infer<typeof openIotDeviceSchema>;

export const openIotDeviceDetailSchema = openIotDeviceSchema.extend({
  shadow: z.object({
    reported: iotMetricsSchema,
    desired: iotMetricsSchema,
    desiredVersion: z.int(),
    reportedAt: z.string().nullable(),
    desiredAt: z.string().nullable(),
  }),
}).meta({ id: 'OpenIotDeviceDetail' });

export type OpenIotDeviceDetail = z.infer<typeof openIotDeviceDetailSchema>;
