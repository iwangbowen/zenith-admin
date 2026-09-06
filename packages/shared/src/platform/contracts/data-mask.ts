import * as z from 'zod';
import { queryBool, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { MASK_TYPES } from '../../core/sensitive';
import { customMaskRuleSchema, revealSensitiveValueSchema, saveDataMaskPolicySchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/**
 * 脱敏策略（数据库中的覆盖记录）。敏感字段本身由契约实体 `sensitive()` 声明，
 * 没有策略记录的字段按契约默认类型脱敏、仅平台超管免脱敏。
 */
export const dataMaskPolicySchema = z.object({
  id: z.int().meta({ example: 1 }),
  entity: z.string().meta({ example: 'User', description: '契约实体名（schema meta.id）' }),
  field: z.string().meta({ example: 'phone', description: '实体内字段路径，嵌套以 . 连接' }),
  maskType: z.enum(MASK_TYPES),
  customRule: customMaskRuleSchema.nullable().meta({ description: '自定义规则（maskType=custom 时使用）' }),
  exemptPermissions: z.array(z.string()).meta({ example: ['system:data-mask:bypass'], description: '拥有任一权限即看到明文' }),
  enabled: z.boolean(),
  remark: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'DataMaskPolicy' });

export type DataMaskPolicy = z.infer<typeof dataMaskPolicySchema>;

/** 契约声明的敏感字段 + 当前生效策略（策略页列表项） */
export const dataMaskFieldSchema = z.object({
  key: z.string().meta({ example: 'User.phone', description: '`entity.field`，策略与前端锁定字段的键' }),
  entity: z.string().meta({ example: 'User' }),
  field: z.string().meta({ example: 'phone' }),
  label: z.string().meta({ example: '手机号' }),
  kind: z.enum(MASK_TYPES).meta({ description: '契约声明的默认脱敏类型' }),
  maskType: z.enum(MASK_TYPES).meta({ description: '当前生效的脱敏类型' }),
  customRule: customMaskRuleSchema.nullable(),
  exemptPermissions: z.array(z.string()),
  enabled: z.boolean(),
  remark: z.string().nullable(),
  overridden: z.boolean().meta({ description: '是否存在策略记录（否则为契约默认）' }),
  policyId: z.int().nullable(),
  preview: z.string().meta({ example: '138****1234', description: '按生效策略计算的示例效果' }),
  updatedAt: z.string().nullable(),
}).meta({ id: 'DataMaskField' });

export type DataMaskField = z.infer<typeof dataMaskFieldSchema>;

/** 当前登录用户视角：哪些字段会被打码、能否按需查看明文 */
export const dataMaskEffectiveSchema = z.object({
  masked: z.array(z.string()).meta({ description: '对当前用户生效（会被打码）的字段键列表' }),
  canReveal: z.boolean().meta({ description: '是否拥有按需查看明文权限' }),
}).meta({ id: 'DataMaskEffective' });

export type DataMaskEffective = z.infer<typeof dataMaskEffectiveSchema>;

export const revealedSensitiveValueSchema = z.object({
  value: z.string().nullable(),
}).meta({ id: 'RevealedSensitiveValue' });

export type RevealedSensitiveValue = z.infer<typeof revealedSensitiveValueSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const dataMaskFieldListQuery = z.object({
  keyword: z.string().optional().meta({ description: '按实体 / 字段 / 标签模糊匹配' }),
  entity: z.string().optional(),
  maskType: queryEnum(MASK_TYPES, '生效脱敏类型'),
  enabled: queryBool('是否启用'),
  overridden: queryBool('仅看已自定义策略的字段'),
});

export const dataMaskFieldParams = z.object({
  entity: z.string().min(1).max(64).meta({ example: 'User' }),
  field: z.string().min(1).max(64).meta({ example: 'phone' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const dataMaskContract = defineContract('/api/data-mask', {
  fields: op.get('/fields', { query: dataMaskFieldListQuery, response: z.array(dataMaskFieldSchema), summary: '敏感字段清单与生效策略' }),
  effective: op.get('/effective', { response: dataMaskEffectiveSchema, summary: '当前用户视角的脱敏字段' }),
  savePolicy: op.put('/fields/{entity}/{field}', { params: dataMaskFieldParams, body: saveDataMaskPolicySchema, response: dataMaskFieldSchema, summary: '保存字段脱敏策略（整体替换）' }),
  resetPolicy: op.delete('/fields/{entity}/{field}', { params: dataMaskFieldParams, response: dataMaskFieldSchema, summary: '恢复字段为契约默认策略' }),
  reveal: op.post('/reveal', { body: revealSensitiveValueSchema, response: revealedSensitiveValueSchema, summary: '按需查看脱敏字段明文（记录审计）' }),
}, { tags: ['DataMask'] });