import * as z from 'zod';
import { entityStatusSchema, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { sendIotCommandSchema, setIotDesiredSchema } from '../validation';
import { iotMetricsSchema } from './devices';
import { openIotDeviceDetailSchema, openIotDeviceSchema } from './open-devices';

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const openIotDeviceSnParam = z.object({
  sn: z.string().min(1).max(64).meta({ description: '设备序列号', example: 'SN-0001' }),
});

export const openIotDeviceListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: 'SN / 名称模糊搜索' }),
  productId: z.coerce.number().int().positive().optional(),
  status: entityStatusSchema.optional(),
});

// ─── 响应 ────────────────────────────────────────────────────────────────────

/** 指令受理回执（在线即推、离线排队至过期） */
export const openIotCommandAcceptedSchema = z.object({
  commandId: z.int(),
  service: z.string(),
  status: z.string(),
  expireAt: z.string(),
}).meta({ id: 'OpenIotCommandAccepted' });

export type OpenIotCommandAccepted = z.infer<typeof openIotCommandAcceptedSchema>;

/** 写入期望属性后的设备影子 */
export const openIotShadowSchema = z.object({
  reported: iotMetricsSchema,
  desired: iotMetricsSchema,
  desiredVersion: z.int(),
  reportedAt: z.string().nullable(),
  desiredAt: z.string().nullable(),
}).meta({ id: 'OpenIotShadow' });

export type OpenIotShadow = z.infer<typeof openIotShadowSchema>;

// ─── 契约：开放网关 IoT 子路由（OAuth2 令牌或 AppKey 签名） ─────────────────────

export const openIotContract = defineContract('/api/open', {
  devices: op.get('/v1/iot/devices', {
    security: 'open-gateway',
    query: openIotDeviceListQuery,
    response: paginated(openIotDeviceSchema),
    summary: '设备列表（含在线状态）',
  }),
  deviceDetail: op.get('/v1/iot/devices/{sn}', {
    security: 'open-gateway',
    params: openIotDeviceSnParam,
    response: openIotDeviceDetailSchema,
    summary: '设备详情（含设备影子 reported / desired）',
  }),
  sendCommand: op.post('/v1/iot/devices/{sn}/commands', {
    security: 'open-gateway',
    params: openIotDeviceSnParam,
    body: sendIotCommandSchema,
    response: openIotCommandAcceptedSchema,
    summary: '下发服务调用指令（在线即推、离线排队至过期）',
  }),
  setDesired: op.post('/v1/iot/devices/{sn}/desired', {
    security: 'open-gateway',
    params: openIotDeviceSnParam,
    body: setIotDesiredSchema,
    response: openIotShadowSchema,
    summary: '设置期望属性（合并写入，设备上线后收敛）',
  }),
}, { tags: ['开放 API · IoT'] });
