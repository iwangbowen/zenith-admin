import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { LOGIN_STATUSES } from '../../identity/constants';
import { MEMBER_STATUSES } from '../constants';
import {
  adjustMemberGrowthSchema,
  adminMakeupCheckinSchema,
  adminResetMemberPasswordSchema,
  batchAddMemberTagsSchema,
  batchUpdateMemberLevelSchema,
  batchUpdateMemberStatusSchema,
  createMemberSchema,
  setMemberStatusSchema,
  setMemberTagsSchema,
  updateMemberSchema,
} from '../validation';
import { makeupCheckinResultSchema } from './member-checkins';
import { memberPointAccountSchema, memberPointTransactionSchema } from './member-points';
import { memberTagBriefSchema } from './member-tags';
import { memberWalletSchema, memberWalletTransactionSchema } from './member-wallets';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const memberSchema = z.object({
  id: z.int(),
  username: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  nickname: z.string(),
  avatar: z.string().nullable(),
  gender: z.string().nullable(),
  birthday: z.string().nullable(),
  status: z.enum(MEMBER_STATUSES),
  levelId: z.int().nullable(),
  levelName: z.string().nullable(),
  vipExpireAt: z.string().nullable().meta({ description: '付费会员（VIP）到期时间，null = 未开通' }),
  growthValue: z.int(),
  experience: z.int(),
  registerSource: z.string(),
  registerIp: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
  lastLoginIp: z.string().nullable(),
  remark: z.string().nullable(),
  hasPassword: z.boolean().meta({ description: '是否已设置登录密码' }),
  pointBalance: z.int().optional().meta({ description: '积分余额（列表 / 详情附加）' }),
  walletBalance: z.int().optional().meta({ description: '钱包余额（分，列表 / 详情附加）' }),
  tags: z.array(memberTagBriefSchema).optional().meta({ description: '会员标签（后台列表 / 详情附加）' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'Member' });

export type Member = z.infer<typeof memberSchema>;

/** 会员轻量下拉选项（积分 / 钱包调整、发券时搜索选择） */
export const memberOptionSchema = z.object({
  id: z.int(),
  nickname: z.string(),
  phone: z.string().nullable(),
  username: z.string().nullable(),
  levelName: z.string().nullable(),
}).meta({ id: 'MemberOption' });

export type MemberOption = z.infer<typeof memberOptionSchema>;

export const memberLoginLogSchema = z.object({
  id: z.int(),
  memberId: z.int().nullable(),
  memberNickname: z.string().nullable().optional().meta({ description: '会员昵称（后台跨会员查询附加）' }),
  ip: z.string().nullable(),
  location: z.string().nullable(),
  browser: z.string().nullable(),
  os: z.string().nullable(),
  userAgent: z.string().nullable(),
  status: z.enum(LOGIN_STATUSES),
  message: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'MemberLoginLog' });

export type MemberLoginLog = z.infer<typeof memberLoginLogSchema>;

/** 会员概览（后台详情侧滑） */
export const memberOverviewSchema = z.object({
  member: memberSchema,
  points: memberPointAccountSchema,
  wallet: memberWalletSchema,
  recentPointTxs: z.array(memberPointTransactionSchema),
  recentWalletTxs: z.array(memberWalletTransactionSchema),
  recentLoginLogs: z.array(memberLoginLogSchema),
  activeCouponCount: z.int(),
  loginLogCount: z.int(),
  checkinTotal: z.int(),
  inviteCode: z.string().nullable(),
  inviter: z.object({ id: z.int(), nickname: z.string() }).nullable(),
  invitedCount: z.int(),
  mpFans: z.array(z.object({ id: z.int(), nickname: z.string().nullable(), openid: z.string() })),
}).meta({ id: 'MemberOverview' });

export type MemberOverview = z.infer<typeof memberOverviewSchema>;

// ─── 契约（后台） ────────────────────────────────────────────────────────────

export const memberListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '昵称 / 手机号 / 用户名 / 邮箱模糊匹配' }),
  status: z.enum(MEMBER_STATUSES).optional(),
  levelId: z.coerce.number().int().positive().optional(),
  tagId: z.coerce.number().int().positive().optional(),
});

export const memberOptionsQuery = z.object({
  keyword: z.string().optional(),
});

export const memberLoginLogListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '会员昵称 / 手机号 / 用户名模糊匹配；纯数字额外按会员 ID 精确匹配' }),
  status: z.enum(LOGIN_STATUSES).optional(),
  dateStart: dateRangeBound('起始日期'),
  dateEnd: dateRangeBound('结束日期'),
});

export const memberContract = defineContract('/api/members', {
  batchStatus: op.put('/batch-status', { body: batchUpdateMemberStatusSchema, summary: '批量更改会员状态' }),
  batchLevel: op.put('/batch-level', { body: batchUpdateMemberLevelSchema, summary: '批量调整会员等级' }),
  batchTags: op.put('/batch-tags', { body: batchAddMemberTagsSchema, summary: '批量为会员追加标签' }),
  overview: op.get('/{id}/overview', { params: idParam, response: memberOverviewSchema, summary: '会员概览（详情侧滑）' }),
  list: op.get('/', { query: memberListQuery, response: paginated(memberSchema), summary: '会员列表' }),
  options: op.get('/options', { query: memberOptionsQuery, response: z.array(memberOptionSchema), summary: '会员搜索下拉（轻量，最多 20 条）' }),
  loginLogs: op.get('/login-logs', { query: memberLoginLogListQuery, response: paginated(memberLoginLogSchema), summary: '会员登录日志' }),
  makeupCheckin: op.post('/{id}/checkin/makeup', { params: idParam, body: adminMakeupCheckinSchema, response: makeupCheckinResultSchema, summary: '会员补签' }),
  adjustGrowth: op.post('/{id}/growth', { params: idParam, body: adjustMemberGrowthSchema, response: memberSchema, summary: '调整会员成长值（自动按阈值重定级）' }),
  setTags: op.put('/{id}/tags', { params: idParam, body: setMemberTagsSchema, response: memberSchema, summary: '设置会员标签（覆盖式）' }),
  detail: op.get('/{id}', { params: idParam, response: memberSchema, summary: '会员详情' }),
  create: op.post('/', { body: createMemberSchema, response: memberSchema, summary: '创建会员' }),
  update: op.put('/{id}', { params: idParam, body: updateMemberSchema, response: memberSchema, summary: '更新会员' }),
  setStatus: op.put('/{id}/status', { params: idParam, body: setMemberStatusSchema, response: memberSchema, summary: '设置会员状态' }),
  resetPassword: op.post('/{id}/reset-password', { params: idParam, body: adminResetMemberPasswordSchema, summary: '重置会员密码' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除会员（软删除）' }),
}, { tags: ['会员管理'] });
