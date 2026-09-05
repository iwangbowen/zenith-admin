import * as z from 'zod';
import { idParam, paginated, paginationQuery, queryBool } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { MASK_TYPES } from '../constants';
import { createDataMaskConfigSchema, customMaskRuleSchema, updateDataMaskConfigSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export type CustomMaskRule = z.infer<typeof customMaskRuleSchema>;

export const dataMaskConfigSchema = z.object({
  id: z.int().meta({ example: 1 }),
  entity: z.string().meta({ example: 'user' }),
  field: z.string().meta({ example: 'phone' }),
  label: z.string().meta({ example: '手机号' }),
  maskType: z.enum(MASK_TYPES),
  customRule: customMaskRuleSchema.nullable().meta({ description: '自定义规则（maskType=custom 时使用）' }),
  exemptRoleCodes: z.array(z.string()).meta({ example: ['super_admin'] }),
  enabled: z.boolean(),
  remark: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'DataMaskConfig' });

export type DataMaskConfig = z.infer<typeof dataMaskConfigSchema>;

/** 数据库敏感字段扫描结果 */
export const sensitiveFieldSchema = z.object({
  tableName: z.string().meta({ example: 'users' }),
  columnName: z.string().meta({ example: 'phone' }),
  dataType: z.string().meta({ example: 'character varying' }),
  suggestedMaskType: z.enum(MASK_TYPES),
  suggestedLabel: z.string().meta({ example: '手机号' }),
  hasRule: z.boolean().meta({ description: '是否已有脱敏规则' }),
}).meta({ id: 'SensitiveField' });

export type SensitiveField = z.infer<typeof sensitiveFieldSchema>;

export const dataMaskBatchCreateResultSchema = z.object({
  created: z.int(),
  skipped: z.int(),
}).meta({ id: 'DataMaskBatchCreateResult' });

export type DataMaskBatchCreateResult = z.infer<typeof dataMaskBatchCreateResultSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const dataMaskConfigListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按实体 / 字段 / 标签模糊匹配' }),
  maskType: z.enum(MASK_TYPES).optional(),
  enabled: queryBool('是否启用'),
});

/** 扫描结果批量入库：只带识别出的字段信息，其余取创建默认值 */
export const batchCreateDataMaskConfigsBody = z.object({
  items: z.array(createDataMaskConfigSchema.pick({ entity: true, field: true, label: true, maskType: true, exemptRoleCodes: true, enabled: true })).min(1),
});

export type BatchCreateDataMaskConfigsInput = z.input<typeof batchCreateDataMaskConfigsBody>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const dataMaskConfigContract = defineContract('/api/data-mask-configs', {
  list: op.get('/', { query: dataMaskConfigListQuery, response: paginated(dataMaskConfigSchema), summary: '数据脱敏规则列表' }),
  scan: op.get('/scan', { response: z.array(sensitiveFieldSchema), summary: '扫描数据库敏感字段' }),
  batchCreate: op.post('/batch-create', { body: batchCreateDataMaskConfigsBody, response: dataMaskBatchCreateResultSchema, summary: '批量创建脱敏规则' }),
  detail: op.get('/{id}', { params: idParam, response: dataMaskConfigSchema, summary: '获取脱敏规则详情' }),
  create: op.post('/', { body: createDataMaskConfigSchema, response: dataMaskConfigSchema, summary: '创建脱敏规则' }),
  update: op.put('/{id}', { params: idParam, body: updateDataMaskConfigSchema, response: dataMaskConfigSchema, summary: '更新脱敏规则' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除脱敏规则' }),
}, { tags: ['DataMaskConfigs'] });
