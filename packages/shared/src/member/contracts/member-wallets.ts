import * as z from 'zod';
import { idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { WALLET_TX_TYPES } from '../constants';
import { adjustMemberWalletSchema, refundMemberWalletSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const memberWalletSchema = z.object({
  memberId: z.int(),
  balance: z.int().meta({ description: '余额（分）' }),
  frozen: z.int(),
  totalRecharge: z.int(),
  totalConsume: z.int(),
}).meta({ id: 'MemberWallet' });

export type MemberWallet = z.infer<typeof memberWalletSchema>;

export const memberWalletTransactionSchema = z.object({
  id: z.int(),
  memberId: z.int(),
  type: z.enum(WALLET_TX_TYPES),
  amount: z.int().meta({ description: '金额变动（分，带符号）' }),
  balanceAfter: z.int(),
  bizType: z.string().nullable(),
  bizId: z.string().nullable(),
  remark: z.string().nullable(),
  memberName: z.string().optional().meta({ description: '会员昵称（后台流水列表附加）' }),
  createdAt: z.string(),
}).meta({ id: 'MemberWalletTransaction' });

export type MemberWalletTransaction = z.infer<typeof memberWalletTransactionSchema>;

// ─── 契约（后台） ────────────────────────────────────────────────────────────

export const memberWalletTransactionListQuery = paginationQuery.extend({
  memberKeyword: z.string().optional().meta({ description: '会员昵称 / 手机号 / 用户名模糊匹配；纯数字额外按会员 ID 精确匹配' }),
  type: z.enum(WALLET_TX_TYPES).optional(),
});

export const memberWalletContract = defineContract('/api/member-wallets', {
  transactions: op.get('/transactions', { query: memberWalletTransactionListQuery, response: paginated(memberWalletTransactionSchema), summary: '钱包流水' }),
  account: op.get('/account/{id}', { params: idParam, response: memberWalletSchema, summary: '会员钱包账户' }),
  adjust: op.post('/adjust', { body: adjustMemberWalletSchema, response: memberWalletSchema, summary: '手动调整余额' }),
  refund: op.post('/refund', { body: refundMemberWalletSchema, response: memberWalletSchema, summary: '钱包退款入账' }),
}, { tags: ['会员钱包'] });
