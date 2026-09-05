import * as z from 'zod';
import { auditFieldsSchema, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createMpKfAccountSchema, mpAccountIdBody, updateMpKfAccountSchema } from '../validation';
import { mpAccountIdQuery, mpSyncResultSchema } from './common';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const mpKfAccountSchema = z.object({
  id: z.int(),
  accountId: z.int(),
  kfAccount: z.string().meta({ description: '客服账号（xxx@公众号原始 ID）' }),
  nickname: z.string(),
  avatar: z.string().nullable(),
  kfId: z.string().nullable().meta({ description: '微信侧客服工号' }),
  inviteStatus: z.string().meta({ description: '邀请绑定状态（none / inviting / bound 等）' }),
  inviteWx: z.string().nullable(),
  status: entityStatusSchema,
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'MpKfAccount' });

export type MpKfAccount = z.infer<typeof mpKfAccountSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const mpKfAccountListQuery = paginationQuery.extend({
  ...mpAccountIdQuery.shape,
  keyword: z.string().optional().meta({ description: '按客服昵称模糊匹配' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const mpKfAccountContract = defineContract('/api/mp/kf-accounts', {
  list: op.get('/', { query: mpKfAccountListQuery, response: paginated(mpKfAccountSchema), summary: '客服账号列表' }),
  sync: op.post('/sync', { body: mpAccountIdBody, response: mpSyncResultSchema, summary: '从微信同步客服账号' }),
  create: op.post('/', { body: createMpKfAccountSchema, response: mpKfAccountSchema, summary: '添加客服账号' }),
  update: op.put('/{id}', { params: idParam, body: updateMpKfAccountSchema, response: mpKfAccountSchema, summary: '修改客服昵称' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除客服账号' }),
}, { tags: ['公众号多客服'] });
