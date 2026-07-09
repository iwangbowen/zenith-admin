import { desc, sql } from 'drizzle-orm';
import { db } from '../../../db';
import { paymentOrders, members } from '../../../db/schema';
import { buildRechargeWhere } from '../../../services/member/member-recharge.service';
import { batchIterable } from '../../excel-export';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';
import type { PaymentChannel, PaymentOrderStatus } from '@zenith/shared';
import { PAYMENT_ORDER_STATUS_LABELS, PAYMENT_CHANNEL_LABELS } from '@zenith/shared';

const STATUS_LABELS: Record<string, string> = PAYMENT_ORDER_STATUS_LABELS;
const CHANNEL_LABELS: Record<string, string> = { ...PAYMENT_CHANNEL_LABELS, mock: '模拟支付' };

type Query = { keyword?: string; status?: PaymentOrderStatus; channel?: PaymentChannel; dateStart?: string; dateEnd?: string };

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 10, type: 'number' },
  { key: 'orderNo', header: '订单号', width: 26 },
  { key: 'memberName', header: '会员昵称', width: 16 },
  { key: 'memberPhone', header: '会员手机号', width: 16, sensitive: true },
  { key: 'amount', header: '充值金额(元)', width: 14, type: 'money' },
  { key: 'paidAmount', header: '实付金额(元)', width: 14, type: 'money' },
  { key: 'channel', header: '支付渠道', width: 12, enumMap: CHANNEL_LABELS },
  { key: 'payMethod', header: '支付方式', width: 16 },
  { key: 'status', header: '状态', width: 12, enumMap: STATUS_LABELS },
  { key: 'paidAt', header: '支付时间', width: 22, type: 'datetime' },
  { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
];

export const memberRechargesExportDefinition = defineExport<Query & Record<string, unknown>, Record<string, unknown>>({
  entity: 'member.recharges',
  moduleName: '会员充值',
  filenamePrefix: '充值记录',
  sourcePath: '/member/recharges',
  sheetName: '充值记录',
  permissions: { export: 'member:recharge:list' },
  execution: { mode: 'auto' },
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async (query) => {
    const joinOn = sql`${members.id}::text = ${paymentOrders.bizId}`;
    const rows = await db.select({ v: sql<number>`count(*)::int` })
      .from(paymentOrders)
      .leftJoin(members, joinOn)
      .where(buildRechargeWhere(query));
    return rows[0]?.v ?? 0;
  },
  streamRows: async (query) => {
    const where = buildRechargeWhere(query);
    const joinOn = sql`${members.id}::text = ${paymentOrders.bizId}`;
    return batchIterable(async (limit, offset) => {
      const rows = await db.select({
        id: paymentOrders.id,
        orderNo: paymentOrders.orderNo,
        memberName: members.nickname,
        memberPhone: members.phone,
        amount: paymentOrders.amount,
        paidAmount: paymentOrders.paidAmount,
        channel: paymentOrders.channel,
        payMethod: paymentOrders.payMethod,
        status: paymentOrders.status,
        paidAt: paymentOrders.paidAt,
        createdAt: paymentOrders.createdAt,
      })
        .from(paymentOrders)
        .leftJoin(members, joinOn)
        .where(where)
        .orderBy(desc(paymentOrders.id))
        .limit(limit)
        .offset(offset);
      return rows;
    });
  },
});
