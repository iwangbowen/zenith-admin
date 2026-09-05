import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { POINT_TX_TYPES } from '../constants';
import { adjustMemberPointsSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const memberPointAccountSchema = z.object({
  memberId: z.int(),
  balance: z.int(),
  frozen: z.int(),
  totalEarned: z.int(),
  totalSpent: z.int(),
}).meta({ id: 'MemberPointAccount' });

export type MemberPointAccount = z.infer<typeof memberPointAccountSchema>;

export const memberPointTransactionSchema = z.object({
  id: z.int(),
  memberId: z.int(),
  type: z.enum(POINT_TX_TYPES),
  amount: z.int().meta({ description: '带符号变动量' }),
  balanceAfter: z.int(),
  bizType: z.string().nullable(),
  bizId: z.string().nullable(),
  remark: z.string().nullable(),
  memberName: z.string().optional().meta({ description: '会员昵称（后台流水列表附加）' }),
  createdAt: z.string(),
}).meta({ id: 'MemberPointTransaction' });

export type MemberPointTransaction = z.infer<typeof memberPointTransactionSchema>;

// ─── 契约（后台） ────────────────────────────────────────────────────────────

export const memberPointTransactionListQuery = paginationQuery.extend({
  memberKeyword: z.string().optional().meta({ description: '会员昵称 / 手机号 / 用户名模糊匹配；纯数字额外按会员 ID 精确匹配' }),
  type: z.enum(POINT_TX_TYPES).optional(),
});

export const memberPointContract = defineContract('/api/member-points', {
  transactions: op.get('/transactions', { query: memberPointTransactionListQuery, response: paginated(memberPointTransactionSchema), summary: '积分流水' }),
  account: op.get('/account/{id}', { params: idParam, response: memberPointAccountSchema, summary: '会员积分账户' }),
  adjust: op.post('/adjust', { body: adjustMemberPointsSchema, response: memberPointAccountSchema, summary: '手动调整积分' }),
}, { tags: ['会员积分'] });
