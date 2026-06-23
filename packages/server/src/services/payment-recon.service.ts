/**
 * 支付对账中心 Service。
 * 上传渠道对账单（CSV），与本地订单逐笔比对，生成差异报表
 * （一致 / 本地有渠道无 / 渠道有本地无 / 金额不一致）。
 */
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { randomInt } from 'node:crypto';
import { db } from '../db';
import {
  paymentOrders,
  paymentReconBatches,
  paymentReconItems,
  type PaymentReconBatchRow,
  type PaymentReconItemRow,
} from '../db/schema';
import { currentUser } from '../lib/context';
import { getCreateTenantId, tenantCondition } from '../lib/tenant';
import { mergeWhere, withPagination } from '../lib/where-helpers';
import { formatDateTime, parseDateTimeInput } from '../lib/datetime';
import type { PaymentChannel, PaymentReconBatch, PaymentReconItem, PaymentReconResult, PaymentReconStatus } from '@zenith/shared';

function genNo(prefix: string): string {
  return `${prefix}${Date.now()}${randomInt(1000, 9999)}`;
}

export function mapReconBatch(row: PaymentReconBatchRow): PaymentReconBatch {
  return {
    id: row.id,
    batchNo: row.batchNo,
    channel: row.channel,
    billDate: row.billDate,
    status: row.status,
    localCount: row.localCount,
    localAmount: row.localAmount,
    channelCount: row.channelCount,
    channelAmount: row.channelAmount,
    matchedCount: row.matchedCount,
    diffCount: row.diffCount,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapReconItem(row: PaymentReconItemRow): PaymentReconItem {
  return {
    id: row.id,
    batchId: row.batchId,
    orderNo: row.orderNo ?? null,
    channelTradeNo: row.channelTradeNo ?? null,
    localAmount: row.localAmount ?? null,
    channelAmount: row.channelAmount ?? null,
    localStatus: row.localStatus ?? null,
    channelStatus: row.channelStatus ?? null,
    result: row.result,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

interface ChannelRecord {
  orderNo: string;
  channelTradeNo?: string;
  amount: number;
  status: string;
}

const CHANNEL_BILL_STATUSES = new Set(['success', 'succeeded', 'paid', 'closed', 'failed', 'refund', 'refunded', 'processing']);
const MAX_BILL_AMOUNT = 999_999_999_999;

/** 解析渠道对账单 CSV：每行 `订单号,渠道交易号,金额(分),状态`。跳过表头与空行。 */
export function parseChannelBill(text: string): ChannelRecord[] {
  const out: ChannelRecord[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const cols = line.split(',').map((c) => c.trim());
    const lineNo = index + 1;
    if (cols.length < 3) throw new HTTPException(400, { message: `渠道账单第 ${lineNo} 行字段不足` });
    const orderNo = cols[0];
    if (!orderNo || /^(订单号|order_?no|out_?trade_?no)$/i.test(orderNo)) continue;
    if (!/^\d+$/.test(cols[2])) throw new HTTPException(400, { message: `渠道账单第 ${lineNo} 行金额必须为整数分` });
    const amount = Number(cols[2]);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_BILL_AMOUNT) {
      throw new HTTPException(400, { message: `渠道账单第 ${lineNo} 行金额超出有效范围` });
    }
    const status = (cols[3] || 'success').trim();
    if (!CHANNEL_BILL_STATUSES.has(status.toLowerCase())) {
      throw new HTTPException(400, { message: `渠道账单第 ${lineNo} 行状态无效：${status}` });
    }
    out.push({ orderNo, channelTradeNo: cols[1] || undefined, amount, status });
  }
  return out;
}

async function loadLocalPaidRows(channel: PaymentChannel, billDate: string) {
  const start = parseDateTimeInput(`${billDate} 00:00:00`);
  const end = parseDateTimeInput(`${billDate} 23:59:59`);
  const tc = tenantCondition(paymentOrders, currentUser());
  return db
    .select({
      orderNo: paymentOrders.orderNo,
      channelTradeNo: paymentOrders.channelTradeNo,
      paidAmount: paymentOrders.paidAmount,
      amount: paymentOrders.amount,
      status: paymentOrders.status,
    })
    .from(paymentOrders)
    .where(
      mergeWhere(
        and(
          eq(paymentOrders.channel, channel),
          inArray(paymentOrders.status, ['success', 'refunding', 'refunded']),
          start ? gte(paymentOrders.paidAt, start) : undefined,
          end ? lte(paymentOrders.paidAt, end) : undefined,
        ),
        tc,
      ),
    );
}

export interface ListReconBatchesQuery {
  page?: number;
  pageSize?: number;
  channel?: PaymentChannel;
  status?: PaymentReconStatus;
}

export async function listReconBatches(q: ListReconBatchesQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  if (q.channel) conds.push(eq(paymentReconBatches.channel, q.channel));
  if (q.status) conds.push(eq(paymentReconBatches.status, q.status));
  const where = mergeWhere(conds.length ? and(...conds) : undefined, tenantCondition(paymentReconBatches, currentUser()));
  const [total, list] = await Promise.all([
    db.$count(paymentReconBatches, where),
    withPagination(db.select().from(paymentReconBatches).where(where).orderBy(desc(paymentReconBatches.id)).$dynamic(), page, pageSize),
  ]);
  return { list: list.map(mapReconBatch), total, page, pageSize };
}

export async function getReconBatch(id: number): Promise<PaymentReconBatch> {
  const tc = tenantCondition(paymentReconBatches, currentUser());
  const [row] = await db.select().from(paymentReconBatches).where(and(eq(paymentReconBatches.id, id), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '对账批次不存在' });
  return mapReconBatch(row);
}

export interface ListReconItemsQuery {
  page?: number;
  pageSize?: number;
  result?: PaymentReconResult;
}

export async function listReconItems(batchId: number, q: ListReconItemsQuery) {
  await getReconBatch(batchId);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  const conds = [eq(paymentReconItems.batchId, batchId)];
  if (q.result) conds.push(eq(paymentReconItems.result, q.result));
  const where = and(...conds);
  const [total, list] = await Promise.all([
    db.$count(paymentReconItems, where),
    withPagination(db.select().from(paymentReconItems).where(where).orderBy(desc(paymentReconItems.id)).$dynamic(), page, pageSize),
  ]);
  return { list: list.map(mapReconItem), total, page, pageSize };
}

export interface CreateReconInput {
  channel: PaymentChannel;
  billDate: string;
  billText: string;
  remark?: string;
}

/** 创建对账批次：解析渠道账单 + 拉本地订单 + 逐笔比对 + 落库统计。 */
export async function createReconBatch(input: CreateReconInput): Promise<PaymentReconBatch> {
  const tenantId = getCreateTenantId(currentUser());
  const channelRecords = parseChannelBill(input.billText);
  const localRows = await loadLocalPaidRows(input.channel, input.billDate);

  const localMap = new Map(localRows.map((r) => [r.orderNo, { amount: r.paidAmount ?? r.amount, status: r.status, channelTradeNo: r.channelTradeNo }]));
  const channelMap = new Map(channelRecords.map((r) => [r.orderNo, r]));

  const items: Array<Omit<typeof paymentReconItems.$inferInsert, 'batchId'>> = [];
  let matched = 0;
  let localAmount = 0;
  let channelAmount = 0;
  for (const orderNo of new Set([...localMap.keys(), ...channelMap.keys()])) {
    const local = localMap.get(orderNo);
    const ch = channelMap.get(orderNo);
    if (local) localAmount += local.amount;
    if (ch) channelAmount += ch.amount;
    let result: PaymentReconResult;
    if (local && ch) result = local.amount === ch.amount ? 'matched' : 'amount_diff';
    else if (local) result = 'local_only';
    else result = 'channel_only';
    if (result === 'matched') matched++;
    items.push({
      orderNo,
      channelTradeNo: ch?.channelTradeNo ?? local?.channelTradeNo ?? null,
      localAmount: local?.amount ?? null,
      channelAmount: ch?.amount ?? null,
      localStatus: local?.status ?? null,
      channelStatus: ch?.status ?? null,
      result,
      remark: null,
    });
  }

  const batchNo = genNo('RECON');
  const diffCount = items.length - matched;
  const row = await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(paymentReconBatches)
      .values({
        batchNo,
        channel: input.channel,
        billDate: input.billDate,
        status: 'done',
        localCount: localMap.size,
        localAmount,
        channelCount: channelMap.size,
        channelAmount,
        matchedCount: matched,
        diffCount,
        remark: input.remark ?? null,
        tenantId,
      })
      .returning();
    if (items.length > 0) {
      await tx.insert(paymentReconItems).values(items.map((it) => ({ ...it, batchId: batch.id })));
    }
    return batch;
  });
  return mapReconBatch(row);
}

export async function deleteReconBatch(id: number): Promise<void> {
  await getReconBatch(id);
  await db.delete(paymentReconBatches).where(eq(paymentReconBatches.id, id));
}

/** Demo/演示：用本地订单生成一份带表头的模拟渠道账单 CSV（金额取实付）。 */
export async function generateSampleBill(channel: PaymentChannel, billDate: string): Promise<string> {
  const rows = await loadLocalPaidRows(channel, billDate);
  const lines = ['订单号,渠道交易号,金额(分),状态'];
  for (const r of rows) {
    lines.push(`${r.orderNo},${r.channelTradeNo ?? ''},${r.paidAmount ?? r.amount},SUCCESS`);
  }
  return lines.join('\n');
}
