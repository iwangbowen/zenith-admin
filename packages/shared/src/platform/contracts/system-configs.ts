import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { CONFIG_TYPES } from '../constants';
import { createSystemConfigSchema, updateSystemConfigSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const systemConfigSchema = z.object({
  id: z.int(),
  configKey: z.string().meta({ example: 'site_title' }),
  configName: z.string().meta({ example: '站点名称' }),
  configValue: z.string().meta({ example: 'Zenith Admin' }),
  configType: z.enum(CONFIG_TYPES),
  description: z.string(),
  tenantId: z.int().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'SystemConfig' });

export type SystemConfig = z.infer<typeof systemConfigSchema>;

/** 公开读取的单项配置（登录页 / 布局开关等匿名场景） */
export const publicConfigSchema = z.object({
  configKey: z.string(),
  configValue: z.string(),
  configType: z.enum(CONFIG_TYPES),
}).meta({ id: 'PublicConfig' });

export type PublicConfig = z.infer<typeof publicConfigSchema>;

export const passwordPolicySchema = z.object({
  minLength: z.int(),
  requireUppercase: z.boolean(),
  requireSpecialChar: z.boolean(),
}).meta({ id: 'PasswordPolicy' });

export type PasswordPolicy = z.infer<typeof passwordPolicySchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const systemConfigListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按键名 / 名称 / 说明模糊匹配' }),
  configType: z.enum(CONFIG_TYPES).optional(),
  keys: z.string().optional().meta({ description: '按 configKey 精确批量查询，逗号分隔，传此参数时忽略分页' }),
});

export const systemConfigKeyParam = z.object({
  key: z.string().meta({ description: '配置键', example: 'site_name' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const systemConfigContract = defineContract('/api/system-configs', {
  publicByKey: op.get('/public/{key}', { params: systemConfigKeyParam, response: publicConfigSchema, public: true, summary: '公开获取单项配置' }),
  passwordPolicy: op.get('/password-policy', { response: passwordPolicySchema, public: true, summary: '获取当前密码策略' }),
  list: op.get('/', { query: systemConfigListQuery, response: paginated(systemConfigSchema), summary: '配置分页列表' }),
  detail: op.get('/{id}', { params: idParam, response: systemConfigSchema, summary: '配置详情' }),
  create: op.post('/', { body: createSystemConfigSchema, response: systemConfigSchema, summary: '新增配置' }),
  update: op.put('/{id}', { params: idParam, body: updateSystemConfigSchema, response: systemConfigSchema, summary: '更新配置' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除配置' }),
}, { tags: ['SystemConfigs'] });
