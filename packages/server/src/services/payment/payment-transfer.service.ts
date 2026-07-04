/**
 * 转账/代付 Service。
 * 对接渠道适配器 transfer/queryTransfer（微信商家转账到零钱、支付宝单笔转账；sandbox 渠道为模拟实现）。
 * 状态机：pending → processing → success / failed；
 * 资金安全：outTransferNo 为渠道幂等键（(channel, out_transfer_no) 唯一），
 * 仅「渠道未受理」（channelTransferNo 为空）的 failed 单允许人工重试，杜绝双付；
 * 转账成功记资金台账（type=transfer, direction=out）。
 */
import { and, desc, eq, gte, inArray, like, lte, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { randomInt } from 'node:crypto';
import { db } from '../../db';
import {
  paymentChannelConfigs,
  paymentTransfers,
  type PaymentChannelConfigRow,
  type PaymentTransferRow,
} from '../../db/schema';
import { currentUser } from '../../lib/context';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { mergeWhere, escapeLike } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { buildAdapterContext } from './payment.service';
import { recordLedgerEntry } from './payment-ledger.service';
import { getAdapter } from '../../lib/payment/registry';
import logger from '../../lib/logger';
import type { CreatePaymentTransferInput, PaymentChannel, PaymentTransfer, PaymentTransferStatus } from '@zenith/shared';
import { PAYMENT_CHANNEL_LABELS } from '@zenith/shared';

const MAX_TRANSFER_ATTEMPTS = 3;

function genNo(): string {
  return `TRF${Date.now()}${randomInt(1000, 9999)}`;
}

export function mapTransfer(row: PaymentTransferRow & { operatorName?: string | null }): PaymentTransfer {
  return {
    id: row.id,
    transferNo: row.transferNo,
    outTransferNo: row.outTransferNo,
    channel: row.channel,
    receiverAccount: row.receiverAccount,
    receiverName: row.receiverName ?? null,
    amount: row.amount,
    remark: row.remark ?? null,
    status: row.status,
    channelTransferNo: row.channelTransferNo ?? null,
    failReason: row.failReason ?? null,
    attempts: row.attempts,
    bizType: row.bizType ?? null,
    bizId: row.bizId ?? null,
    finishedAt: formatNullableDateTime(row.finishedAt),
    operatorName: row.operatorName ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function resolveTransferConfig(channel: PaymentChannel, channelConfigId?: number): Promise<PaymentChannelConfigRow> {
  const tc = tenantCondition(paymentChannelConfigs, currentUser());
  if (channelConfigId) {
    const [row] = await db.select().from(paymentChannelConfigs).where(and(eq(paymentChannelConfigs.id, channelConfigId), tc)).limit(1);
    if (!row) throw new HTTPException(404, { message: '支付渠道配置不存在' });
    return row;
  }
  const [row] = await db
    .select()
    .from(paymentChannelConfigs)
    .where(and(eq(paymentChannelConfigs.channel, channel), eq(paymentChannelConfigs.isDefault, true), eq(paymentChannelConfigs.status, 'enabled'), tc))
    .limit(1);
  if (!row) throw new HTTPException(400, { message: `未配置默认${PAYMENT_CHANNEL_LABELS[channel]}支付渠道` });
  return row;
}

async function ensureTransfer(id: number): Promise<PaymentTransferRow> {
  const tc = tenantCondition(paymentTransfers, currentUser());
  const [row] = await db.select().from(paymentTransfers).where(and(eq(paymentTransfers.id, id), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '转账单不存在' });
  return row;
}

export async function getTransfer(id: number): Promise<PaymentTransfer> {
  return mapTransfer(await ensureTransfer(id));
}

/** 调渠道执行转账并落状态（成功/受理中/失败），成功时记资金台账。供发起与重试复用。 */
async function executeTransferAtChannel(row: PaymentTransferRow, config: PaymentChannelConfigRow): Promise<PaymentTransferRow> {
  const adapter = getAdapter(row.channel);
  if (!adapter.transfer) throw new HTTPException(400, { message: `渠道 ${row.channel} 暂不支持转账` });
  try {
    const res = await adapter.transfer(buildAdapterContext(config), {
      outTransferNo: row.outTransferNo,
      receiverAccount: row.receiverAccount,
      receiverName: row.receiverName ?? undefined,
      amount: row.amount,
      remark: row.remark ?? undefined,
    });
    const status: PaymentTransferStatus = res.status;
    const [updated] = await db
      .update(paymentTransfers)
      .set({
        status,
        channelTransferNo: res.channelTransferNo ?? row.channelTransferNo,
        attempts: row.attempts + 1,
        failReason: null,
        finishedAt: status === 'success' || status === 'failed' ? new Date() : null,
      })
      .where(eq(paymentTransfers.id, row.id))
      .returning();
    if (updated.status === 'success') await recordTransferLedger(updated);
    return updated;
  } catch (err) {
    const failReason = (err instanceof Error ? err.message : '渠道转账请求失败').slice(0, 500);
    logger.error('[payment-transfer] channel transfer failed', { transferNo: row.transferNo, err: failReason });
    const [updated] = await db
      .update(paymentTransfers)
      .set({ status: 'failed', attempts: row.attempts + 1, failReason, finishedAt: new Date() })
      .where(eq(paymentTransfers.id, row.id))
      .returning();
    return updated;
  }
}

/** 转账成功记台账（type=transfer，按 transferNo 落在 refundNo 以外的 orderNo 维度去重不适用，直接以 entry 去重：orderNo 传 transferNo）。 */
async function recordTransferLedger(row: PaymentTransferRow): Promise<void> {
  await recordLedgerEntry({
    direction: 'out',
    type: 'transfer',
    amount: row.amount,
    orderNo: row.transferNo,
    channel: row.channel,
    bizType: row.bizType,
    tenantId: row.tenantId,
    remark: `转账支出（${row.receiverAccount}）`,
  });
}

/** 发起转账：落单（pending）→ 调渠道 → 状态落地。渠道失败不抛错，返回 failed 单据供列表重试。 */
export async function createTransfer(input: CreatePaymentTransferInput & { operatorId?: number }): Promise<PaymentTransfer> {
  const config = await resolveTransferConfig(input.channel, input.channelConfigId);
  const user = currentUser();
  const transferNo = genNo();
  const [created] = await db
    .insert(paymentTransfers)
    .values({
      transferNo,
      outTransferNo: transferNo,
      channel: input.channel,
      channelConfigId: config.id,
      receiverAccount: input.receiverAccount,
      receiverName: input.receiverName ?? null,
      amount: input.amount,
      remark: input.remark ?? null,
      status: 'pending',
      bizType: input.bizType ?? null,
      bizId: input.bizId ?? null,
      operatorId: input.operatorId ?? user.userId,
      tenantId: getCreateTenantId(user),
    })
    .returning();
  const updated = await executeTransferAtChannel(created, config);
  return mapTransfer(updated);
}

/** 主动查询渠道转账结果并同步本地状态（processing 单的兜底纠偏）。 */
export async function syncTransferStatus(id: number): Promise<PaymentTransfer> {
  const row = await ensureTransfer(id);
  if (row.status === 'success' || row.status === 'pending') return mapTransfer(row);
  const config = row.channelConfigId
    ? (await db.select().from(paymentChannelConfigs).where(eq(paymentChannelConfigs.id, row.channelConfigId)).limit(1))[0]
    : undefined;
  if (!config) return mapTransfer(row);
  const adapter = getAdapter(row.channel);
  if (!adapter.queryTransfer) return mapTransfer(row);
  let res;
  try {
    res = await adapter.queryTransfer(buildAdapterContext(config), { outTransferNo: row.outTransferNo });
  } catch (err) {
    logger.warn('[payment-transfer] query failed', { transferNo: row.transferNo, err });
    return mapTransfer(row);
  }
  if (res.status === 'processing') return mapTransfer(row);
  const [updated] = await db
    .update(paymentTransfers)
    .set({
      status: res.status,
      channelTransferNo: res.channelTransferNo ?? row.channelTransferNo,
      failReason: res.failReason?.slice(0, 500) ?? row.failReason,
      finishedAt: res.finishedAt ?? new Date(),
    })
    .where(and(eq(paymentTransfers.id, row.id), inArray(paymentTransfers.status, ['processing', 'failed'])))
    .returning();
  if (!updated) return mapTransfer(row);
  if (updated.status === 'success') await recordTransferLedger(updated); // 此前必为 processing/failed，首次转成功须记账
  return mapTransfer(updated);
}

/** 人工重试失败转账：仅渠道未受理（channelTransferNo 为空）且未达尝试上限的 failed 单可重试，杜绝双付。 */
export async function retryTransfer(id: number): Promise<PaymentTransfer> {
  const row = await ensureTransfer(id);
  if (row.status !== 'failed') throw new HTTPException(400, { message: '仅失败的转账单可重试' });
  if (row.channelTransferNo) throw new HTTPException(400, { message: '渠道已受理该转账单，请通过「查单」同步结果，不可重复发起' });
  if (row.attempts >= MAX_TRANSFER_ATTEMPTS) throw new HTTPException(400, { message: `已达重试上限（${MAX_TRANSFER_ATTEMPTS} 次）` });
  const config = row.channelConfigId
    ? (await db.select().from(paymentChannelConfigs).where(eq(paymentChannelConfigs.id, row.channelConfigId)).limit(1))[0]
    : undefined;
  if (!config) throw new HTTPException(400, { message: '渠道配置不存在，无法重试' });
  const updated = await executeTransferAtChannel(row, config);
  return mapTransfer(updated);
}

/** 同步所有 processing 转账单（cron 兜底）。 */
export async function syncProcessingTransfers(): Promise<{ scanned: number; finished: number }> {
  const rows = await db.select().from(paymentTransfers).where(eq(paymentTransfers.status, 'processing')).limit(50);
  let finished = 0;
  for (const row of rows) {
    const config = row.channelConfigId
      ? (await db.select().from(paymentChannelConfigs).where(eq(paymentChannelConfigs.id, row.channelConfigId)).limit(1))[0]
      : undefined;
    if (!config) continue;
    const adapter = getAdapter(row.channel);
    if (!adapter.queryTransfer) continue;
    try {
      const res = await adapter.queryTransfer(buildAdapterContext(config), { outTransferNo: row.outTransferNo });
      if (res.status === 'processing') continue;
      const [updated] = await db
        .update(paymentTransfers)
        .set({
          status: res.status,
          channelTransferNo: res.channelTransferNo ?? row.channelTransferNo,
          failReason: res.failReason?.slice(0, 500) ?? null,
          finishedAt: res.finishedAt ?? new Date(),
        })
        .where(and(eq(paymentTransfers.id, row.id), eq(paymentTransfers.status, 'processing')))
        .returning();
      if (updated) {
        if (updated.status === 'success') await recordTransferLedger(updated);
        finished++;
      }
    } catch (err) {
      logger.warn('[payment-transfer] sync processing failed', { transferNo: row.transferNo, err });
    }
  }
  return { scanned: rows.length, finished };
}

// ─── 列表查询 ─────────────────────────────────────────────────────────────────
export interface ListTransfersQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  channel?: PaymentChannel;
  status?: PaymentTransferStatus;
  startTime?: string;
  endTime?: string;
}

export async function listTransfers(q: ListTransfersQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  if (q.keyword) {
    const kw = `%${escapeLike(q.keyword)}%`;
    conds.push(or(like(paymentTransfers.transferNo, kw), like(paymentTransfers.receiverAccount, kw)));
  }
  if (q.channel) conds.push(eq(paymentTransfers.channel, q.channel));
  if (q.status) conds.push(eq(paymentTransfers.status, q.status));
  const start = parseDateTimeInput(q.startTime);
  const end = parseDateTimeInput(q.endTime);
  if (start) conds.push(gte(paymentTransfers.createdAt, start));
  if (end) conds.push(lte(paymentTransfers.createdAt, end));
  const where = mergeWhere(conds.length ? and(...conds) : undefined, tenantCondition(paymentTransfers, currentUser()));
  const [total, rows] = await Promise.all([
    db.$count(paymentTransfers, where),
    db.query.paymentTransfers.findMany({
      where,
      orderBy: desc(paymentTransfers.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
      with: { operator: { columns: { nickname: true, username: true } } },
    }),
  ]);
  const list = rows.map((r) => mapTransfer({ ...r, operatorName: r.operator?.nickname ?? r.operator?.username ?? null }));
  return { list, total, page, pageSize };
}

/** 转账汇总（列表页顶部统计） */
export async function getTransferSummary(q: ListTransfersQuery) {
  const conds = [];
  if (q.channel) conds.push(eq(paymentTransfers.channel, q.channel));
  const where = mergeWhere(conds.length ? and(...conds) : undefined, tenantCondition(paymentTransfers, currentUser()));
  const [row] = await db
    .select({
      totalAmount: sql<number>`coalesce(sum(case when ${paymentTransfers.status} = 'success' then ${paymentTransfers.amount} else 0 end),0)`,
      successCount: sql<number>`count(*) filter (where ${paymentTransfers.status} = 'success')`,
      processingCount: sql<number>`count(*) filter (where ${paymentTransfers.status} = 'processing')`,
      failedCount: sql<number>`count(*) filter (where ${paymentTransfers.status} = 'failed')`,
    })
    .from(paymentTransfers)
    .where(where);
  return {
    totalAmount: Number(row?.totalAmount ?? 0),
    successCount: Number(row?.successCount ?? 0),
    processingCount: Number(row?.processingCount ?? 0),
    failedCount: Number(row?.failedCount ?? 0),
  };
}
