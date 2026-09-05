import * as z from 'zod';
import { dateRangeBound, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { PAYMENT_CHANNELS, PAYMENT_ORDER_STATUSES } from '../../payment/constants';
import { MEMBER_RECHARGE_STATUSES } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 会员充值记录：支付订单（bizType = member_recharge）的会员视图 */
export const memberRechargeSchema = z.object({
  id: z.int(),
  orderNo: z.string(),
  outTradeNo: z.string(),
  channelTradeNo: z.string().nullable(),
  memberId: z.int().nullable(),
  memberNickname: z.string().nullable(),
  memberPhone: z.string().nullable(),
  subject: z.string(),
  amount: z.int().meta({ description: '充值金额（分）' }),
  channel: z.enum(PAYMENT_CHANNELS),
  payMethod: z.string(),
  status: z.enum(PAYMENT_ORDER_STATUSES),
  paidAmount: z.int().nullable(),
  paidAt: z.string().nullable(),
  expiredAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'MemberRecharge' });

export type MemberRecharge = z.infer<typeof memberRechargeSchema>;

// ─── 契约（后台） ────────────────────────────────────────────────────────────

export const memberRechargeListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '订单号 / 商户单号 / 会员昵称 / 手机号' }),
  status: z.enum(MEMBER_RECHARGE_STATUSES).optional(),
  channel: z.enum(PAYMENT_CHANNELS).optional(),
  dateStart: dateRangeBound('起始日期'),
  dateEnd: dateRangeBound('结束日期'),
});

export const memberRechargeContract = defineContract('/api/member-recharges', {
  list: op.get('/', { query: memberRechargeListQuery, response: paginated(memberRechargeSchema), summary: '会员充值记录' }),
}, { tags: ['会员充值'] });
