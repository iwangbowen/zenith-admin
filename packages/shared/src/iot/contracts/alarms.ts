import * as z from 'zod';
import { auditFieldsSchema, dateRangeQuery, entityStatusQuery, entityStatusSchema, idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { IOT_ALARM_LEVELS, IOT_ALARM_RULE_TYPES, IOT_ALARM_STATUSES, IOT_COMPARE_OPS } from '../constants';
import {
  createIotAlarmRuleSchema, createIotMaintenanceWindowSchema, resolveIotAlarmSchema, updateIotAlarmRuleSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const iotAlarmRuleSchema = z.object({
  id: z.int(),
  name: z.string(),
  productId: z.int(),
  productName: z.string().nullable(),
  deviceId: z.int().nullable().meta({ description: '空 = 产品下全部设备；指定则仅对该设备生效' }),
  deviceName: z.string().nullable(),
  ruleType: z.enum(IOT_ALARM_RULE_TYPES),
  propertyIdentifier: z.string().nullable().meta({ description: 'threshold：监控的属性标识符' }),
  operator: z.enum(IOT_COMPARE_OPS).nullable(),
  threshold: z.number().nullable(),
  consecutiveCount: z.int().meta({ description: 'threshold：连续 N 个点满足才触发（抖动抑制）' }),
  offlineMinutes: z.int().nullable().meta({ description: 'offline：离线超过 N 分钟触发' }),
  eventIdentifier: z.string().nullable().meta({ description: 'event：匹配的物模型事件标识符' }),
  level: z.enum(IOT_ALARM_LEVELS),
  notifyUserIds: z.array(z.int()),
  escalateAfterMinutes: z.int().nullable().meta({ description: '触发后 N 分钟未认领 / 未恢复 → 升级通知（null = 不升级）' }),
  escalateUserIds: z.array(z.int()),
  status: entityStatusSchema,
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'IotAlarmRule' });

export type IotAlarmRule = z.infer<typeof iotAlarmRuleSchema>;

export const iotAlarmSchema = z.object({
  id: z.int(),
  ruleId: z.int().nullable().meta({ description: '规则删除后记录保留（ruleName 冗余展示）' }),
  ruleName: z.string(),
  deviceId: z.int(),
  deviceName: z.string().nullable(),
  deviceSn: z.string().nullable(),
  ruleType: z.enum(IOT_ALARM_RULE_TYPES),
  level: z.enum(IOT_ALARM_LEVELS),
  status: z.enum(IOT_ALARM_STATUSES),
  message: z.string(),
  context: z.record(z.string(), z.unknown()).nullable().meta({ description: '触发上下文：{ value, threshold, offlineMinutes, eventPayload… }' }),
  firedAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  acknowledgedBy: z.int().nullable(),
  acknowledgedByName: z.string().nullable(),
  escalatedAt: z.string().nullable().meta({ description: '升级通知已发出时间（每条告警至多升级一次）' }),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.int().nullable(),
  resolvedByName: z.string().nullable(),
  resolveNote: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'IotAlarm' });

export type IotAlarm = z.infer<typeof iotAlarmSchema>;

/** 计划性维护静默：窗口内命中的告警仍记录但不派发通知 / 升级 */
export const iotMaintenanceWindowSchema = z.object({
  id: z.int(),
  name: z.string(),
  productId: z.int().nullable(),
  productName: z.string().nullable(),
  groupId: z.int().nullable(),
  groupName: z.string().nullable(),
  deviceId: z.int().nullable(),
  deviceName: z.string().nullable(),
  startAt: z.string(),
  endAt: z.string(),
  reason: z.string().nullable(),
  active: z.boolean().meta({ description: '当前是否生效中' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'IotMaintenanceWindow' });

export type IotMaintenanceWindow = z.infer<typeof iotMaintenanceWindowSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const iotAlarmListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按规则名 / 告警内容 / 设备名 / SN 模糊匹配' }),
  status: queryEnum(IOT_ALARM_STATUSES),
  level: queryEnum(IOT_ALARM_LEVELS),
  ruleType: queryEnum(IOT_ALARM_RULE_TYPES),
  deviceId: z.coerce.number().int().positive().optional(),
  ...dateRangeQuery('触发时间'),
});

export const iotAlarmRuleListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  productId: z.coerce.number().int().positive().optional(),
  ruleType: queryEnum(IOT_ALARM_RULE_TYPES),
  status: entityStatusQuery,
});

export const iotMaintenanceWindowListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

const TAGS = ['IoT 告警'] as const;

export const iotAlarmContract = defineContract('/api/iot/alarms', {
  list: op.get('/', { query: iotAlarmListQuery, response: paginated(iotAlarmSchema), summary: '告警记录（含设备信息，按触发时间倒序）' }),
  acknowledge: op.post('/{id}/acknowledge', { params: idParam, response: iotAlarmSchema, summary: '认领告警（接手处理，升级计时停止）' }),
  resolve: op.post('/{id}/resolve', {
    params: idParam,
    body: resolveIotAlarmSchema,
    response: iotAlarmSchema,
    summary: '手动处理告警（标记已恢复，可附处理备注）',
  }),
}, { tags: TAGS });

export const iotAlarmRuleContract = defineContract('/api/iot/alarm-rules', {
  list: op.get('/', { query: iotAlarmRuleListQuery, response: paginated(iotAlarmRuleSchema), summary: '告警规则列表' }),
  create: op.post('/', { body: createIotAlarmRuleSchema, response: iotAlarmRuleSchema, summary: '创建告警规则（阈值/离线/事件）' }),
  update: op.put('/{id}', { params: idParam, body: updateIotAlarmRuleSchema, response: iotAlarmRuleSchema, summary: '更新告警规则（规则类型与所属产品不可变更）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除告警规则（历史告警记录保留）' }),
}, { tags: TAGS });

export const iotMaintenanceWindowContract = defineContract('/api/iot/maintenance-windows', {
  list: op.get('/', { query: iotMaintenanceWindowListQuery, response: paginated(iotMaintenanceWindowSchema), summary: '维护窗口列表（窗口内告警静默通知，仍记录）' }),
  create: op.post('/', { body: createIotMaintenanceWindowSchema, response: iotMaintenanceWindowSchema, summary: '创建维护窗口' }),
  update: op.put('/{id}', { params: idParam, body: createIotMaintenanceWindowSchema, response: iotMaintenanceWindowSchema, summary: '更新维护窗口' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除维护窗口' }),
}, { tags: TAGS });
