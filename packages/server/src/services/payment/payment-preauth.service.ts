/**
 * 预授权 Service（资金冻结/解冻/转支付，押金类场景：酒店/租车/共享）。
 *
 * 状态机：pending →(渠道冻结) frozen →(转支付) captured / (解冻) released；冻结失败 → failed。
 * 转支付落 payment_orders（payMethod=wechat_preauth/alipay_preauth）并走 markOrderPaid
 * 完整履约链（台账/费率/账户/Webhook），剩余冻结资金渠道侧自动解冻。
 * 资金账户联动：冻结成功 account.frozen += 冻结额；转支付/解冻 -= 冻结额（快照口径 =
 * 进行中预授权冻结金额之和，checkAccounts 一并核对）。
 */
import { and, desc, eq, gte, like, lte, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { randomInt } from 'node:crypto';
import { db } from '../../db';
import {
  paymentAccounts,
  paymentChannelConfigs,
  paymentOrders,
  paymentPreauths,
  type PaymentOrderRow,
  type PaymentPreauthRow,
} from '../../db/schema';
import { currentUser, currentUserOrNull } from '../../lib/context';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { mergeWhere, escapeLike } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime, formatNullableDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { getAdapter } from '../../lib/payment/registry';
import { buildAdapterContext, markOrderPaid } from './payment.service';
import { ensureAccount } from './payment-account.service';
import logger from '../../lib/logger';
import type { CapturePaymentPreauthInput, CreatePaymentPreauthInput, PaymentChannel, PaymentPreauth, PaymentPreauthStatus } from '@zenith/shared';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_CHANNEL } from '@zenith/shared';

function genNo(): string {
  return `PRE${Date.now()}${randomInt(1000, 9999)}`;
}

export function mapPreauth(row: PaymentPreauthRow & { operator?: { nickname: string | null } | null }): PaymentPreauth {
  return {
    id: row.id,
    preauthNo: row.preauthNo,
    channel: row.channel,
    channelConfigId: row.channelConfigId ?? null,
    channelPreauthNo: row.channelPreauthNo ?? null,
    bizType: row.bizType,
    bizId: row.bizId,
    subject: row.subject,
    payerAccount: row.payerAccount,
    frozenAmount: row.frozenAmount,
    capturedAmount: row.capturedAmount ?? null,
    captureOrderNo: row.captureOrderNo ?? null,
    status: row.status,
    errorMessage: row.errorMessage ?? null,
    frozenAt: formatNullableDateTime(row.frozenAt),
    finishedAt: formatNullableDateTime(row.finishedAt),
    remark: row.remark ?? null,
    operatorName: row.operator?.nickname ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 账户冻结余额原子增减（联动失败仅告警，快照可由 check 发现并人工修正） */
async function applyFrozenDelta(channel: PaymentChannel, tenantId: number | null, delta: number): Promise<void> {
  try {
    const account = await ensureAccount(channel, tenantId);
    await db
      .update(paymentAccounts)
      .set({ frozen: sql`${paymentAccounts.frozen} + ${delta}`, version: sql`${paymentAccounts.version} + 1` })
      .where(eq(paymentAccounts.id, account.id));
  } catch (err) {
    logger.error('[payment-preauth] apply frozen delta failed', { channel, delta, err: err instanceof Error ? err.message : err });
  }
}

async function resolvePreauthConfig(channel: PaymentChannel, channelConfigId?: number | null) {
  if (channelConfigId) {
    const [row] = await db.select().from(paymentChannelConfigs).where(eq(paymentChannelConfigs.id, channelConfigId)).limit(1);
    if (!row) throw new HTTPException(404, { message: '支付渠道配置不存在' });
    return row;
  }
  const [row] = await db
    .select()
    .from(paymentChannelConfigs)
    .where(and(eq(paymentChannelConfigs.channel, channel), eq(paymentChannelConfigs.isDefault, true), eq(paymentChannelConfigs.status, 'enabled')))
    .limit(1);
  if (!row) throw new HTTPException(400, { message: `未配置默认${PAYMENT_CHANNEL_LABELS[channel]}支付渠道` });
  return row;
}

// ─── 查询 ─────────────────────────────────────────────────────────────────────

export interface ListPreauthsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: PaymentPreauthStatus;
  channel?: PaymentChannel;
  startTime?: string;
  endTime?: string;
}

function preauthsTenantCondition() {
  const user = currentUserOrNull();
  return user ? tenantCondition(paymentPreauths, user) : undefined;
}

export async function listPreauths(q: ListPreauthsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  if (q.keyword) {
    const kw = `%${escapeLike(q.keyword)}%`;
    conds.push(or(like(paymentPreauths.preauthNo, kw), like(paymentPreauths.payerAccount, kw), like(paymentPreauths.subject, kw)));
  }
  if (q.status) conds.push(eq(paymentPreauths.status, q.status));
  if (q.channel) conds.push(eq(paymentPreauths.channel, q.channel));
  const start = parseDateRangeStart(q.startTime);
  const end = parseDateRangeEnd(q.endTime);
  if (start) conds.push(gte(paymentPreauths.createdAt, start));
  if (end) conds.push(lte(paymentPreauths.createdAt, end));
  const where = mergeWhere(conds.length ? and(...conds) : undefined, preauthsTenantCondition());
  const [total, rows] = await Promise.all([
    db.$count(paymentPreauths, where),
    db.query.paymentPreauths.findMany({
      where,
      with: { operator: { columns: { nickname: true } } },
      orderBy: desc(paymentPreauths.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  return { list: rows.map(mapPreauth), total, page, pageSize };
}

export async function ensurePreauth(id: number): Promise<PaymentPreauthRow> {
  const [row] = await db.select().from(paymentPreauths).where(and(eq(paymentPreauths.id, id), preauthsTenantCondition())).limit(1);
  if (!row) throw new HTTPException(404, { message: '预授权单不存在' });
  return row;
}

// ─── 冻结 / 转支付 / 解冻 ─────────────────────────────────────────────────────

/** 发起预授权冻结（沙箱渠道即时冻结成功；渠道失败置 failed 可重新发起） */
export async function createPreauth(input: CreatePaymentPreauthInput): Promise<PaymentPreauth> {
  const user = currentUser();
  const channel = PAYMENT_METHOD_CHANNEL[input.payMethod];
  const config = await resolvePreauthConfig(channel, input.channelConfigId);
  const adapter = getAdapter(channel);
  if (!adapter.preauthFreeze) throw new HTTPException(400, { message: `渠道 ${channel} 暂不支持预授权` });

  const preauthNo = genNo();
  const bizType = input.bizType?.trim() || 'admin_preauth';
  const [row] = await db
    .insert(paymentPreauths)
    .values({
      preauthNo,
      channel,
      channelConfigId: config.id,
      bizType,
      bizId: preauthNo,
      subject: input.subject,
      payerAccount: input.payerAccount,
      frozenAmount: input.frozenAmount,
      status: 'pending',
      remark: input.remark ?? null,
      operatorId: user.userId,
      tenantId: getCreateTenantId(user),
    })
    .returning();

  try {
    const res = await adapter.preauthFreeze(buildAdapterContext(config), {
      outPreauthNo: preauthNo,
      payerAccount: input.payerAccount,
      amount: input.frozenAmount,
      subject: input.subject,
    });
    if (res.status === 'frozen') {
      const [updated] = await db
        .update(paymentPreauths)
        .set({ status: 'frozen', channelPreauthNo: res.channelPreauthNo ?? null, frozenAt: new Date() })
        .where(and(eq(paymentPreauths.id, row.id), eq(paymentPreauths.status, 'pending')))
        .returning();
      await applyFrozenDelta(channel, row.tenantId, input.frozenAmount);
      return mapPreauth(updated ?? row);
    }
    // 真实渠道异步授权：保持 pending（本期沙箱恒为 frozen）
    const [updated] = await db
      .update(paymentPreauths)
      .set({ channelPreauthNo: res.channelPreauthNo ?? null })
      .where(eq(paymentPreauths.id, row.id))
      .returning();
    return mapPreauth(updated ?? row);
  } catch (err) {
    const reason = (err instanceof Error ? err.message : '渠道冻结请求失败').slice(0, 500);
    const [updated] = await db
      .update(paymentPreauths)
      .set({ status: 'failed', errorMessage: reason, finishedAt: new Date() })
      .where(eq(paymentPreauths.id, row.id))
      .returning();
    logger.warn('[payment-preauth] freeze failed', { preauthNo, reason });
    return mapPreauth(updated ?? row);
  }
}

/**
 * 转支付：冻结资金转正式交易（金额 ≤ 冻结额，剩余渠道侧自动解冻）。
 * 生成支付订单并走 markOrderPaid 完整履约链（台账/费率/账户/Webhook）。
 */
export async function capturePreauth(id: number, input: CapturePaymentPreauthInput): Promise<PaymentPreauth> {
  const row = await ensurePreauth(id);
  if (row.status !== 'frozen') throw new HTTPException(400, { message: '仅已冻结的预授权可转支付' });
  if (!row.channelPreauthNo) throw new HTTPException(400, { message: '预授权缺少渠道授权单号' });
  const captureAmount = input.captureAmount ?? row.frozenAmount;
  if (captureAmount > row.frozenAmount) throw new HTTPException(400, { message: '转支付金额不能超过冻结金额' });

  const config = await resolvePreauthConfig(row.channel, row.channelConfigId);
  const adapter = getAdapter(row.channel);
  if (!adapter.preauthCapture) throw new HTTPException(400, { message: `渠道 ${row.channel} 暂不支持预授权转支付` });

  // 并发防护：先占用 captured 流转（原子条件更新），渠道失败再回滚为 frozen
  const [claimed] = await db
    .update(paymentPreauths)
    .set({ status: 'captured', capturedAmount: captureAmount, finishedAt: new Date() })
    .where(and(eq(paymentPreauths.id, id), eq(paymentPreauths.status, 'frozen')))
    .returning();
  if (!claimed) throw new HTTPException(400, { message: '预授权状态已变化，请刷新后重试' });

  const orderNo = genNo().replace('PRE', 'PAC');
  const payMethod = row.channel === 'wechat' ? ('wechat_preauth' as const) : ('alipay_preauth' as const);
  let order: PaymentOrderRow;
  try {
    [order] = await db
      .insert(paymentOrders)
      .values({
        orderNo,
        outTradeNo: orderNo,
        bizType: row.bizType,
        bizId: row.bizId,
        subject: `${row.subject}（预授权转支付）`,
        body: `预授权单 ${row.preauthNo}`,
        amount: captureAmount,
        currency: 'CNY',
        channel: row.channel,
        channelConfigId: config.id,
        payMethod,
        status: 'pending',
        openId: row.payerAccount,
        tenantId: row.tenantId,
      })
      .returning();
    const res = await adapter.preauthCapture(buildAdapterContext(config), {
      channelPreauthNo: row.channelPreauthNo,
      outPreauthNo: row.preauthNo,
      outTradeNo: orderNo,
      captureAmount,
      subject: row.subject,
    });
    if (res.status !== 'success') throw new HTTPException(400, { message: res.failReason ?? '渠道转支付失败' });
    await markOrderPaid(order, { channelTradeNo: res.channelTradeNo, paidAmount: captureAmount, paidAt: new Date() });
  } catch (err) {
    // 回滚状态占用并标记失败原因（订单若已落库置 failed 由渠道失败路径处理；此处直接关闭）
    await db
      .update(paymentPreauths)
      .set({ status: 'frozen', capturedAmount: null, finishedAt: null, errorMessage: (err instanceof Error ? err.message : '转支付失败').slice(0, 500) })
      .where(and(eq(paymentPreauths.id, id), eq(paymentPreauths.status, 'captured')));
    await db.update(paymentOrders).set({ status: 'closed', errorMessage: '预授权转支付失败' }).where(and(eq(paymentOrders.orderNo, orderNo), eq(paymentOrders.status, 'pending')));
    throw err;
  }

  const [final] = await db
    .update(paymentPreauths)
    .set({ captureOrderNo: orderNo })
    .where(eq(paymentPreauths.id, id))
    .returning();
  await applyFrozenDelta(row.channel, row.tenantId, -row.frozenAmount);
  return mapPreauth(final ?? claimed);
}

/** 解冻：全额释放冻结资金（frozen → released） */
export async function releasePreauth(id: number): Promise<PaymentPreauth> {
  const row = await ensurePreauth(id);
  if (row.status !== 'frozen') throw new HTTPException(400, { message: '仅已冻结的预授权可解冻' });
  const config = await resolvePreauthConfig(row.channel, row.channelConfigId);
  const adapter = getAdapter(row.channel);
  if (adapter.preauthRelease) {
    await adapter.preauthRelease(buildAdapterContext(config), { outPreauthNo: row.preauthNo, channelPreauthNo: row.channelPreauthNo ?? undefined });
  }
  const [updated] = await db
    .update(paymentPreauths)
    .set({ status: 'released', finishedAt: new Date() })
    .where(and(eq(paymentPreauths.id, id), eq(paymentPreauths.status, 'frozen')))
    .returning();
  if (!updated) throw new HTTPException(400, { message: '预授权状态已变化，请刷新后重试' });
  await applyFrozenDelta(row.channel, row.tenantId, -row.frozenAmount);
  return mapPreauth(updated);
}
