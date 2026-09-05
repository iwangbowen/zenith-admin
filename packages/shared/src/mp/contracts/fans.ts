import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery, queryBool } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { MP_FAN_SUBSCRIBES } from '../constants';
import { bindMpFanMemberSchema, blacklistMpFansSchema, mpAccountIdBody, updateMpFanSchema } from '../validation';
import { mpAccountIdQuery } from './common';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const mpFanSchema = z.object({
  id: z.int(),
  accountId: z.int(),
  openid: z.string(),
  nickname: z.string().nullable(),
  avatar: z.string().nullable(),
  sex: z.int().meta({ description: '0 未知 / 1 男 / 2 女' }),
  country: z.string().nullable(),
  province: z.string().nullable(),
  city: z.string().nullable(),
  language: z.string().nullable(),
  subscribe: z.enum(MP_FAN_SUBSCRIBES),
  subscribeTime: z.string().nullable(),
  remark: z.string().nullable(),
  tagIds: z.array(z.int()).meta({ description: '本地标签 ID 列表' }),
  unionid: z.string().nullable(),
  memberId: z.int().nullable().meta({ description: '已绑定的会员 ID' }),
  blacklisted: z.boolean(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'MpFan' });

export type MpFan = z.infer<typeof mpFanSchema>;

export const mpFanSyncResultSchema = z.object({
  success: z.boolean(),
  synced: z.int(),
  total: z.int(),
}).meta({ id: 'MpFanSyncResult' });

export type MpFanSyncResult = z.infer<typeof mpFanSyncResultSchema>;

export const mpFanBlacklistResultSchema = z.object({
  success: z.boolean(),
  count: z.int(),
}).meta({ id: 'MpFanBlacklistResult' });

export type MpFanBlacklistResult = z.infer<typeof mpFanBlacklistResultSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const mpFanListQuery = paginationQuery.extend({
  ...mpAccountIdQuery.shape,
  keyword: z.string().optional().meta({ description: '按昵称 / openid / 备注模糊匹配' }),
  subscribe: z.enum(MP_FAN_SUBSCRIBES).optional(),
  tagId: z.coerce.number().int().positive().optional().meta({ description: '按本地标签筛选' }),
  blacklisted: queryBool('是否在黑名单'),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const mpFanContract = defineContract('/api/mp/fans', {
  list: op.get('/', { query: mpFanListQuery, response: paginated(mpFanSchema), summary: '粉丝列表' }),
  sync: op.post('/sync', { body: mpAccountIdBody, response: mpFanSyncResultSchema, summary: '从微信同步粉丝' }),
  blacklist: op.post('/blacklist', { body: blacklistMpFansSchema, response: mpFanBlacklistResultSchema, summary: '批量拉黑粉丝' }),
  unblacklist: op.post('/unblacklist', { body: blacklistMpFansSchema, response: mpFanBlacklistResultSchema, summary: '批量移出黑名单' }),
  syncBlacklist: op.post('/sync-blacklist', { body: mpAccountIdBody, response: mpFanSyncResultSchema, summary: '从微信同步黑名单' }),
  update: op.put('/{id}', { params: idParam, body: updateMpFanSchema, response: mpFanSchema, summary: '更新粉丝备注/标签' }),
  createMember: op.post('/{id}/create-member', { params: idParam, response: mpFanSchema, summary: '为粉丝创建并绑定会员' }),
  bindMember: op.post('/{id}/bind-member', { params: idParam, body: bindMpFanMemberSchema, response: mpFanSchema, summary: '绑定粉丝到已有会员' }),
  unbindMember: op.post('/{id}/unbind-member', { params: idParam, response: mpFanSchema, summary: '解绑粉丝会员' }),
}, { tags: ['公众号粉丝'] });
