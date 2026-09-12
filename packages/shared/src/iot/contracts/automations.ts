import * as z from 'zod';
import { auditFieldsSchema, entityStatusQuery, entityStatusSchema, idParam, idQuery, paginated, paginationQuery, queryBool, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  IOT_AUTOMATION_ACTION_TYPES, IOT_AUTOMATION_TARGETS, IOT_AUTOMATION_TRIGGERS, IOT_COMPARE_OPS,
} from '../constants';
import { createIotAutomationSchema, updateIotAutomationSchema } from '../validation';
import { iotMetricsSchema } from './devices';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 联动动作（jsonb 内嵌，随联动整体编辑） */
export const iotAutomationActionSchema = z.object({
  type: z.enum(IOT_AUTOMATION_ACTION_TYPES),
  target: z.enum(IOT_AUTOMATION_TARGETS).optional().meta({ description: 'self 触发设备 / device 指定设备 / group 指定分组（command / desired 用）' }),
  targetDeviceId: z.int().nullable().optional(),
  targetGroupId: z.int().nullable().optional(),
  service: z.string().nullable().optional().meta({ description: 'command：服务标识符' }),
  params: z.record(z.string(), z.unknown()).nullable().optional(),
  desired: iotMetricsSchema.nullable().optional().meta({ description: 'desired：期望属性' }),
  userIds: z.array(z.int()).nullable().optional().meta({ description: 'notify：接收人（管理端用户）' }),
  workflowDefinitionId: z.int().nullable().optional().meta({ description: 'workflow：流程定义 id' }),
  formData: z.record(z.string(), z.unknown()).nullable().optional(),
}).meta({ id: 'IotAutomationAction' });

export type IotAutomationAction = z.infer<typeof iotAutomationActionSchema>;

export const iotAutomationSchema = z.object({
  id: z.int(),
  name: z.string(),
  productId: z.int(),
  productName: z.string().nullable(),
  deviceId: z.int().nullable().meta({ description: '空 = 产品下全部设备触发；指定则仅该设备' }),
  deviceName: z.string().nullable(),
  triggerType: z.enum(IOT_AUTOMATION_TRIGGERS),
  propertyIdentifier: z.string().nullable(),
  operator: z.enum(IOT_COMPARE_OPS).nullable(),
  threshold: z.number().nullable(),
  eventIdentifier: z.string().nullable(),
  decisionRuleKey: z.string().nullable().meta({ description: '规则中心决策表 key（软引用，命中任意行才执行动作）' }),
  cooldownSeconds: z.int().meta({ description: '同一联动 × 同一触发设备在窗口内不重复执行' }),
  actions: z.array(iotAutomationActionSchema),
  status: entityStatusSchema,
  recentRunCount: z.int().meta({ description: '近 24h 执行次数' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'IotAutomation' });

export type IotAutomation = z.infer<typeof iotAutomationSchema>;

export const iotAutomationRunSchema = z.object({
  id: z.int(),
  automationId: z.int(),
  automationName: z.string(),
  deviceId: z.int(),
  deviceName: z.string().nullable(),
  deviceSn: z.string().nullable(),
  triggerContext: z.record(z.string(), z.unknown()),
  results: z.array(z.object({
    type: z.string(),
    target: z.string().optional(),
    success: z.boolean(),
    message: z.string().optional(),
  })),
  success: z.boolean(),
  createdAt: z.string(),
}).meta({ id: 'IotAutomationRun' });

export type IotAutomationRun = z.infer<typeof iotAutomationRunSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const iotAutomationListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  productId: idQuery(),
  triggerType: queryEnum(IOT_AUTOMATION_TRIGGERS),
  status: entityStatusQuery,
});

export const iotAutomationRunListQuery = paginationQuery.extend({
  automationId: idQuery(),
  deviceId: idQuery(),
  success: queryBool('仅成功 / 仅失败'),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const iotAutomationContract = defineContract('/api/iot/automations', {
  list: op.get('/', { query: iotAutomationListQuery, response: paginated(iotAutomationSchema), summary: '联动规则列表（含近 24h 触发次数）' }),
  runs: op.get('/runs', { query: iotAutomationRunListQuery, response: paginated(iotAutomationRunSchema), summary: '联动执行记录（按时间倒序）' }),
  create: op.post('/', { body: createIotAutomationSchema, response: iotAutomationSchema, summary: '创建联动规则（触发器 + 动作编排）' }),
  update: op.put('/{id}', { params: idParam, body: updateIotAutomationSchema, response: iotAutomationSchema, summary: '更新联动规则（触发类型与所属产品不可变更）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除联动规则（执行记录级联删除）' }),
}, { tags: ['IoT 场景联动'] });
