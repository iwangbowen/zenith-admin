import * as z from 'zod';
import { auditFieldsSchema, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { MP_ACCOUNT_TYPES, MP_ENCRYPT_MODES } from '../constants';
import { createMpAccountSchema, updateMpAccountSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const mpAccountSchema = z.object({
  id: z.int(),
  name: z.string(),
  account: z.string().nullable().meta({ description: '微信号（原始 ID）' }),
  appId: z.string(),
  appSecret: z.string().meta({ description: '脱敏：列表 / 写操作返回掩码，编辑回显为空串' }),
  token: z.string(),
  encodingAesKey: z.string().nullable(),
  encryptMode: z.enum(MP_ENCRYPT_MODES),
  type: z.enum(MP_ACCOUNT_TYPES),
  qrCodeUrl: z.string().nullable(),
  isDefault: z.boolean(),
  autoCreateMember: z.boolean(),
  contentCheckEnabled: z.boolean(),
  status: entityStatusSchema,
  remark: z.string().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'MpAccount' });

export type MpAccount = z.infer<typeof mpAccountSchema>;

export const mpConnectionTestSchema = z.object({
  success: z.boolean(),
  message: z.string(),
}).meta({ id: 'MpConnectionTest' });

export type MpConnectionTest = z.infer<typeof mpConnectionTestSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const mpAccountListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称 / 微信号 / AppID 模糊匹配' }),
  type: z.enum(MP_ACCOUNT_TYPES).optional(),
  status: entityStatusSchema.optional(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const mpAccountContract = defineContract('/api/mp/accounts', {
  list: op.get('/', { query: mpAccountListQuery, response: paginated(mpAccountSchema), summary: '公众号列表' }),
  detail: op.get('/{id}', { params: idParam, response: mpAccountSchema, summary: '获取公众号详情' }),
  create: op.post('/', { body: createMpAccountSchema, response: mpAccountSchema, summary: '创建公众号' }),
  update: op.put('/{id}', { params: idParam, body: updateMpAccountSchema, response: mpAccountSchema, summary: '更新公众号' }),
  setDefault: op.post('/{id}/default', { params: idParam, response: mpAccountSchema, summary: '设为默认公众号' }),
  testConnection: op.post('/{id}/test', {
    params: idParam,
    response: mpConnectionTestSchema,
    summary: '测试公众号连接',
    description: '使用账号 AppID/AppSecret 向微信换取 access_token，验证配置有效性并缓存 token。',
  }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除公众号' }),
}, { tags: ['公众号管理'] });
