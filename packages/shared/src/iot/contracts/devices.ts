import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, dateRangeQuery, entityStatusQuery, entityStatusSchema, idParam, idQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  IOT_COMMAND_STATUSES, IOT_DEVICE_EVENT_KINDS, IOT_EVENT_LEVELS, IOT_LOG_LEVELS, IOT_NODE_TYPES,
} from '../constants';
import { createIotDeviceSchema, sendIotCommandSchema, setIotDesiredSchema, updateIotDeviceSchema } from '../validation';

// ─── 属性值 ──────────────────────────────────────────────────────────────────

/** 遥测 / 影子中的单个属性值 */
export const iotMetricValueSchema = z.union([z.number(), z.string(), z.boolean()]);

export type IotMetricValue = z.infer<typeof iotMetricValueSchema>;

/** 属性值袋：`{ temperature: 23.5, door: 'open' }` */
export const iotMetricsSchema = z.record(z.string(), iotMetricValueSchema);

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const iotDeviceSchema = z.object({
  id: z.int(),
  sn: z.string().meta({ description: '设备序列号（接入寻址标识）', example: 'SN-A1B2C3D4E5F60708' }),
  secret: z.string().meta({ description: '接入密钥（管理端可见，用于设备侧签名）' }),
  productId: z.int(),
  productName: z.string().nullable(),
  name: z.string(),
  status: entityStatusSchema,
  nodeType: z.enum(IOT_NODE_TYPES).meta({ description: 'direct 直连 / gateway 网关 / sub 子设备' }),
  gatewayId: z.int().nullable().meta({ description: '子设备所属网关（仅 nodeType = sub）' }),
  gatewayName: z.string().nullable(),
  subDeviceCount: z.int().meta({ description: '网关的子设备数' }),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  address: z.string().nullable(),
  online: z.boolean().meta({ description: '实时在线态（Redis TTL 键存活即在线）' }),
  firmwareVersion: z.string().nullable(),
  activatedAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  reported: iotMetricsSchema.nullable().meta({ description: '影子 reported 快照' }),
  desired: iotMetricsSchema.nullable().meta({ description: '影子 desired 待确认增量' }),
  groupIds: z.array(z.int()),
  groupNames: z.array(z.string()),
  remark: z.string().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'IotDevice' });

export type IotDevice = z.infer<typeof iotDeviceSchema>;

/** 设备影子（reported / desired / 持久化在线标记） */
export const iotDeviceShadowSchema = z.object({
  deviceId: z.int(),
  reported: iotMetricsSchema,
  reportedAt: z.string().nullable(),
  desired: iotMetricsSchema,
  desiredVersion: z.int().meta({ description: 'desired 每次变更 +1，设备侧幂等' }),
  desiredAt: z.string().nullable(),
  online: z.boolean(),
  updatedAt: z.string(),
}).meta({ id: 'IotDeviceShadow' });

export type IotDeviceShadow = z.infer<typeof iotDeviceShadowSchema>;

export const iotDeviceEventSchema = z.object({
  id: z.int(),
  deviceId: z.int(),
  kind: z.enum(IOT_DEVICE_EVENT_KINDS),
  identifier: z.string().meta({ description: 'lifecycle：online / offline / activated / secret_reset；model：物模型事件标识符' }),
  name: z.string(),
  level: z.enum(IOT_EVENT_LEVELS),
  payload: z.record(z.string(), z.unknown()).nullable(),
  reportedAt: z.string(),
}).meta({ id: 'IotDeviceEvent' });

export type IotDeviceEvent = z.infer<typeof iotDeviceEventSchema>;

export const iotTelemetryPointSchema = z.object({
  metrics: iotMetricsSchema,
  reportedAt: z.string(),
}).meta({ id: 'IotTelemetryPoint' });

export type IotTelemetryPoint = z.infer<typeof iotTelemetryPointSchema>;

/** 遥测小时聚合点（长窗口图表：min / max / avg 区间带） */
export const iotTelemetryAggPointSchema = z.object({
  bucket: z.string().meta({ description: '小时桶起点 YYYY-MM-DD HH:mm:ss' }),
  minValue: z.number(),
  maxValue: z.number(),
  avgValue: z.number(),
  count: z.int(),
}).meta({ id: 'IotTelemetryAggPoint' });

export type IotTelemetryAggPoint = z.infer<typeof iotTelemetryAggPointSchema>;

export const iotCommandSchema = z.object({
  id: z.int(),
  deviceId: z.int(),
  service: z.string(),
  params: z.record(z.string(), z.unknown()).nullable(),
  status: z.enum(IOT_COMMAND_STATUSES),
  expireAt: z.string(),
  sentAt: z.string().nullable(),
  ackedAt: z.string().nullable(),
  response: z.record(z.string(), z.unknown()).nullable(),
  errorMsg: z.string().nullable(),
  createdBy: z.int().nullable(),
  createdAt: z.string(),
}).meta({ id: 'IotCommand' });

export type IotCommand = z.infer<typeof iotCommandSchema>;

export const iotTopologyChildSchema = z.object({
  id: z.int(),
  sn: z.string(),
  name: z.string(),
  status: entityStatusSchema,
  online: z.boolean(),
  firingAlarmCount: z.int().meta({ description: '活跃告警数（拓扑节点红点）' }),
  lastSeenAt: z.string().nullable(),
}).meta({ id: 'IotTopologyChild' });

export type IotTopologyChild = z.infer<typeof iotTopologyChildSchema>;

/** 网关拓扑：网关节点 + 全部子设备 */
export const iotDeviceTopologySchema = z.object({
  gateway: z.object({
    id: z.int(),
    sn: z.string(),
    name: z.string(),
    online: z.boolean(),
  }),
  children: z.array(iotTopologyChildSchema),
}).meta({ id: 'IotTopology' });

export type IotDeviceTopology = z.infer<typeof iotDeviceTopologySchema>;

export const iotDeviceLogSchema = z.object({
  id: z.int(),
  deviceId: z.int(),
  level: z.enum(IOT_LOG_LEVELS),
  tag: z.string().nullable().meta({ description: '模块 / 标签（设备侧自定义，如 net / sensor / ota）' }),
  content: z.string(),
  reportedAt: z.string(),
}).meta({ id: 'IotDeviceLog' });

export type IotDeviceLog = z.infer<typeof iotDeviceLogSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const iotDeviceListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按 SN / 设备名模糊匹配' }),
  status: entityStatusQuery,
  productId: idQuery(),
  groupId: idQuery(),
  nodeType: queryEnum(IOT_NODE_TYPES),
  gatewayId: idQuery(),
  ...dateRangeQuery('创建时间'),
});

export const iotTelemetryQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).optional().meta({ description: '时间窗天数，默认 1' }),
  limit: z.coerce.number().int().min(1).max(2000).optional().meta({ description: '最大点数，默认 500' }),
});

export const iotTelemetryAggQuery = z.object({
  property: z.string().min(1).max(64).meta({ description: '数值属性标识符' }),
  days: z.coerce.number().int().min(1).max(90).optional().meta({ description: '时间窗天数，默认 7' }),
});

export const iotDeviceEventListQuery = paginationQuery.extend({
  kind: queryEnum(IOT_DEVICE_EVENT_KINDS),
  level: queryEnum(IOT_EVENT_LEVELS),
});

export const iotDeviceLogListQuery = paginationQuery.extend({
  level: queryEnum(IOT_LOG_LEVELS),
  keyword: z.string().optional().meta({ description: '按日志内容模糊匹配' }),
  ...dateRangeQuery('上报时间'),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const iotDeviceContract = defineContract('/api/iot/devices', {
  list: op.get('/', { query: iotDeviceListQuery, response: paginated(iotDeviceSchema), summary: '设备列表（含在线态与最近指标快照）' }),
  removeBatch: op.delete('/batch', { body: batchIdsBody, summary: '批量删除设备' }),
  detail: op.get('/{id}', { params: idParam, response: iotDeviceSchema, summary: '设备详情（含接入凭证与实时状态）' }),
  telemetryAgg: op.get('/{id}/telemetry/agg', {
    params: idParam,
    query: iotTelemetryAggQuery,
    response: z.array(iotTelemetryAggPointSchema),
    summary: '设备遥测小时聚合（长窗口图表：min/max/avg 区间带）',
  }),
  telemetry: op.get('/{id}/telemetry', {
    params: idParam,
    query: iotTelemetryQuery,
    response: z.array(iotTelemetryPointSchema),
    summary: '设备遥测（时间窗内点列，升序）',
  }),
  listCommands: op.get('/{id}/commands', { params: idParam, query: paginationQuery, response: paginated(iotCommandSchema), summary: '指令下发记录' }),
  sendCommand: op.post('/{id}/commands', {
    params: idParam,
    body: sendIotCommandSchema,
    response: iotCommandSchema,
    summary: '下发指令（WS 在线即时推送，离线等待上线补推）',
  }),
  resetSecret: op.post('/{id}/reset-secret', { params: idParam, response: iotDeviceSchema, summary: '重置接入密钥（旧密钥立即失效）' }),
  clearTelemetry: op.delete('/{id}/telemetry', { params: idParam, summary: '清空设备遥测数据' }),
  shadow: op.get('/{id}/shadow', { params: idParam, response: iotDeviceShadowSchema, summary: '设备影子（reported / desired / 在线标记）' }),
  setDesired: op.put('/{id}/shadow/desired', {
    params: idParam,
    body: setIotDesiredSchema,
    response: iotDeviceShadowSchema,
    summary: '设置期望属性（rw 属性，按物模型校验；WS 在线即时推送）',
  }),
  clearDesired: op.delete('/{id}/shadow/desired', { params: idParam, response: iotDeviceShadowSchema, summary: '清空期望属性（放弃未确认的下发）' }),
  events: op.get('/{id}/events', {
    params: idParam,
    query: iotDeviceEventListQuery,
    response: paginated(iotDeviceEventSchema),
    summary: '设备事件流（生命周期 + 物模型事件，倒序）',
  }),
  topology: op.get('/{id}/topology', { params: idParam, response: iotDeviceTopologySchema, summary: '网关拓扑（子设备 + 在线态 + 活跃告警数）' }),
  logs: op.get('/{id}/logs', {
    params: idParam,
    query: iotDeviceLogListQuery,
    response: paginated(iotDeviceLogSchema),
    summary: '设备运行日志（级别/关键字筛选，倒序）',
  }),
  create: op.post('/', { body: createIotDeviceSchema, response: iotDeviceSchema, summary: '注册设备（自动生成 SN 与接入密钥）' }),
  update: op.put('/{id}', { params: idParam, body: updateIotDeviceSchema, response: iotDeviceSchema, summary: '更新设备' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除设备（级联清除遥测与指令）' }),
}, { tags: ['IoT 设备'] });
