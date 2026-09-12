import * as z from 'zod';
import { auditFieldsSchema, entityStatusQuery, entityStatusSchema, idParam, idQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { IOT_FORWARD_SOURCES, IOT_FORWARD_STATUSES } from '../constants';
import { createIotForwardRuleSchema, updateIotForwardRuleSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const iotForwardRuleSchema = z.object({
  id: z.int(),
  name: z.string(),
  source: z.enum(IOT_FORWARD_SOURCES),
  productId: z.int().nullable().meta({ description: '过滤：产品（空 = 全部产品）' }),
  productName: z.string().nullable(),
  groupId: z.int().nullable().meta({ description: '过滤：设备分组（空 = 不限分组）' }),
  groupName: z.string().nullable(),
  url: z.string().meta({ description: '目的地：HTTP POST 地址' }),
  hasSecret: z.boolean().meta({ description: '是否配置了签名密钥（密钥本体不回显）' }),
  headers: z.record(z.string(), z.string()).nullable(),
  status: entityStatusSchema,
  consecutiveFailures: z.int().meta({ description: '连续投递失败计数；达到阈值自动停用' }),
  autoDisabledAt: z.string().nullable(),
  recentDeliveryCount: z.int().meta({ description: '近 24h 投递数' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'IotForwardRule' });

export type IotForwardRule = z.infer<typeof iotForwardRuleSchema>;

export const iotForwardLogSchema = z.object({
  id: z.int(),
  ruleId: z.int(),
  ruleName: z.string(),
  source: z.enum(IOT_FORWARD_SOURCES),
  deviceId: z.int().nullable(),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(IOT_FORWARD_STATUSES),
  responseStatus: z.int().nullable(),
  errorMessage: z.string().nullable(),
  durationMs: z.int().nullable(),
  createdAt: z.string(),
}).meta({ id: 'IotForwardLog' });

export type IotForwardLog = z.infer<typeof iotForwardLogSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const iotForwardRuleListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  source: queryEnum(IOT_FORWARD_SOURCES),
  status: entityStatusQuery,
});

export const iotForwardLogListQuery = paginationQuery.extend({
  ruleId: idQuery(),
  status: queryEnum(IOT_FORWARD_STATUSES),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const iotForwardRuleContract = defineContract('/api/iot/forward-rules', {
  list: op.get('/', { query: iotForwardRuleListQuery, response: paginated(iotForwardRuleSchema), summary: '流转规则列表（含近 24h 投递数）' }),
  logs: op.get('/logs', { query: iotForwardLogListQuery, response: paginated(iotForwardLogSchema), summary: '投递日志（按时间倒序）' }),
  create: op.post('/', { body: createIotForwardRuleSchema, response: iotForwardRuleSchema, summary: '创建流转规则（HTTP 推送目的地，可选 HMAC 签名）' }),
  update: op.put('/{id}', { params: idParam, body: updateIotForwardRuleSchema, response: iotForwardRuleSchema, summary: '更新流转规则（数据源不可变更；启停会清零失败计数）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除流转规则（投递日志级联删除）' }),
}, { tags: ['IoT 数据流转'] });
