import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PUSH_PROVIDERS } from '../constants';
import { createPushConfigSchema, testPushSendSchema, updatePushConfigSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** App 推送凭证（一对一挂应用）：列表脱敏 appKey 且不含 masterSecret；详情回传原文 appKey 与空 masterSecret（留空即不更新） */
export const pushConfigSchema = z.object({
  id: z.int(),
  appId: z.int(),
  appName: z.string().optional().meta({ description: '所属应用名称（JOIN 冗余）' }),
  name: z.string(),
  provider: z.enum(PUSH_PROVIDERS),
  appKey: z.string(),
  masterSecret: z.string().optional().meta({ description: '仅详情返回，恒为空串；编辑留空表示保持原值' }),
  apnsProduction: z.boolean().meta({ description: 'iOS APNs 环境：true=生产 false=开发' }),
  status: entityStatusSchema,
  remark: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'PushConfig' });

export type PushConfig = z.infer<typeof pushConfigSchema>;

export const pushTestSendResultSchema = z.object({
  msgId: z.string().nullable().meta({ description: '供应商消息 ID' }),
}).meta({ id: 'PushTestSendResult' });

export type PushTestSendResult = z.infer<typeof pushTestSendResultSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const pushConfigListQuery = paginationQuery.extend({
  keyword: z.string().max(256).optional().meta({ description: '按名称 / 备注模糊匹配' }),
  provider: z.enum(PUSH_PROVIDERS).optional(),
  status: entityStatusSchema.optional(),
});

export const pushConfigContract = defineContract('/api/push-configs', {
  list: op.get('/', { query: pushConfigListQuery, response: paginated(pushConfigSchema), summary: '推送配置列表' }),
  detail: op.get('/{id}', { params: idParam, response: pushConfigSchema, summary: '推送配置详情（编辑回填，密钥不回传）' }),
  create: op.post('/', { body: createPushConfigSchema, response: pushConfigSchema, summary: '创建推送配置' }),
  update: op.put('/{id}', { params: idParam, body: updatePushConfigSchema, response: pushConfigSchema, summary: '更新推送配置' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除推送配置' }),
  testSend: op.post('/{id}/test', { params: idParam, body: testPushSendSchema, response: pushTestSendResultSchema, summary: '测试发送（直发 RegistrationID）' }),
}, { tags: ['推送管理'] });
