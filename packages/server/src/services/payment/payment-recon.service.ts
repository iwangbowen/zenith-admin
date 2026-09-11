/**
 * 支付对账中心 Service。
 * 上传渠道对账单（CSV），与本地订单逐笔比对，生成差异报表
 * （一致 / 本地有渠道无 / 渠道有本地无 / 金额不一致）。
 * 差异处理流：差异项创建时置 handleStatus=pending，人工处理流转为 已调账/挂账/已忽略。
 * 自动对账：sandbox 渠道用本地订单生成模拟账单（演示闭环），真实渠道调 adapter.downloadBill 拉取渠道账单。
 */
import { and, desc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { genPaymentNo } from './payment-no';
import { db } from '../../db';
import { buildListResult } from '../../lib/list-query';
import {
  paymentChannelConfigs,
  paymentApps,
  paymentOrders,
  paymentReconBatches,
  paymentReconItems,
  type PaymentReconBatchRow,
  type PaymentReconItemRow,
} from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { requireTenantScopeId, tenantCondition, exactTenantCondition } from '../../lib/tenant';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { formatDate, formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import { postSystemJournalWithin } from './payment-journal.service';
import { buildAdapterContext } from './payment.service';
import { getAdapter } from '../../lib/payment/registry';
import { assertPaymentEngineConfig } from './payment-channel-config-resolver';
import { assertEffectivePaymentOperation } from './payment-capability-evaluator';
import logger from '../../lib/logger';
import type { SQL } from 'drizzle-orm';
import type { HandlePaymentReconItemInput, PaymentChannel, PaymentReconBatch, PaymentReconHandleStatus, PaymentReconItem, PaymentReconResult, PaymentReconSource, PaymentReconStatus } from '@zenith/shared/payment';

export function mapReconBatch(row: PaymentReconBatchRow): PaymentReconBatch {
  return {
    id: row.id,
    batchNo: row.batchNo,
    channel: row.channel,
    appId: row.appId,
    channelConfigId: row.channelConfigId,
    currency: row.currency,
    billDate: row.billDate,
    source: row.source,
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
    handleStatus: row.handleStatus ?? null,
    handleRemark: row.handleRemark ?? null,
    handledAt: formatNullableDateTime(row.handledAt),
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

function normalizeReconStatus(status: string | null | undefined): 'success' | 'refunded' | 'closed' | 'failed' | 'processing' | null {
  switch (status?.trim().toLowerCase()) {
    case 'success':
    case 'succeeded':
    case 'paid':
    case 'refunding':
      return 'success';
    case 'refund':
    case 'refunded':
      return 'refunded';
    case 'closed':
      return 'closed';
    case 'failed':
      return 'failed';
    case 'processing':
    case 'paying':
    case 'unknown':
    case 'pending':
      return 'processing';
    default:
      return null;
  }
}

async function loadLocalPaidRowsScoped(channel: PaymentChannel, appId: number, channelConfigId: number, currency: string, billDate: string, orderWhere?: SQL) {
  const start = parseDateTimeInput(`${billDate} 00:00:00`);
  const end = parseDateTimeInput(`${billDate} 23:59:59`);
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
      buildWhere(
        and(
          eq(paymentOrders.channel, channel),
          eq(paymentOrders.appId, appId),
          eq(paymentOrders.channelConfigId, channelConfigId),
          eq(paymentOrders.currency, currency),
          inArray(paymentOrders.status, ['success', 'refunding', 'refunded']),
          start ? gte(paymentOrders.paidAt, start) : undefined,
          end ? lte(paymentOrders.paidAt, end) : undefined,
        ),
        orderWhere,
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
  const where = buildWhere(...conds, tenantCondition(paymentReconBatches, currentUser()));
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentReconBatches, where),
    rows: () => withPagination(db.select().from(paymentReconBatches).where(where).orderBy(desc(paymentReconBatches.id)).$dynamic(), page, pageSize),
    map: mapReconBatch,
  });
}

export async function getReconBatch(id: number): Promise<PaymentReconBatch> {
  const tc = tenantCondition(paymentReconBatches, currentUser());
  const [row] = await db.select().from(paymentReconBatches).where(and(eq(paymentReconBatches.id, id), tc)).limit(1);
  requireRow(row, '对账批次不存在');
  return mapReconBatch(row);
}

export interface ListReconItemsQuery {
  page?: number;
  pageSize?: number;
  result?: PaymentReconResult;
  handleStatus?: PaymentReconHandleStatus;
}

export async function listReconItems(batchId: number, q: ListReconItemsQuery) {
  await getReconBatch(batchId);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  const conds = [eq(paymentReconItems.batchId, batchId)];
  if (q.result) conds.push(eq(paymentReconItems.result, q.result));
  if (q.handleStatus) conds.push(eq(paymentReconItems.handleStatus, q.handleStatus));
  const where = and(...conds);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentReconItems, where),
    rows: () => withPagination(db.select().from(paymentReconItems).where(where).orderBy(desc(paymentReconItems.id)).$dynamic(), page, pageSize),
    map: mapReconItem,
  });
}

export interface CreateReconInput {
  applicationId: number;
  channel: PaymentChannel;
  channelConfigId: number;
  currency: string;
  billDate: string;
  billText: string;
  remark?: string;
}

/** 创建对账批次（路由入口）：按当前登录用户租户口径。 */
export async function createReconBatch(input: CreateReconInput): Promise<PaymentReconBatch> {
  const user = currentUser();
  const tenantId = requireTenantScopeId(user);
  const orderWhere = exactTenantCondition(paymentOrders.tenantId, tenantId);
  await ensureReconConfig(input.channelConfigId, input.channel, tenantId);
  const appId = await resolveReconApplication(input.channelConfigId, input.channel, tenantId, input.applicationId);
  if (appId !== input.applicationId) throw new HTTPException(400, { message: '支付应用与商户配置绑定关系无效' });
  return createReconBatchScoped(input, { tenantId, orderWhere }, 'manual_upload');
}

interface ReconScope {
  /** 批次归属租户 */
  tenantId: number | null;
  /** 本地订单聚合的租户过滤（undefined = 不过滤） */
  orderWhere?: SQL;
}

/** 对账核心：解析渠道账单 + 拉本地订单 + 逐笔比对 + 落库统计。不依赖请求上下文，供路由与定时任务复用。 */
async function createReconBatchScoped(
  input: CreateReconInput,
  scope: ReconScope,
  source: PaymentReconSource,
): Promise<PaymentReconBatch> {
  const channelRecords = parseChannelBill(input.billText);
  const localRows = await loadLocalPaidRowsScoped(input.channel, input.applicationId, input.channelConfigId, input.currency, input.billDate, scope.orderWhere);

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
    if (local && ch) {
      if (local.amount !== ch.amount) result = 'amount_diff';
      else result = normalizeReconStatus(local.status) === normalizeReconStatus(ch.status) ? 'matched' : 'status_diff';
    }
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
      handleStatus: result === 'matched' ? null : 'pending', // 差异项进入待处理队列
      remark: null,
    });
  }

  const batchNo = genPaymentNo('RECON');
  const diffCount = items.length - matched;
  const row = await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(paymentReconBatches)
      .values({
        batchNo,
        channel: input.channel,
        appId: input.applicationId,
        channelConfigId: input.channelConfigId,
        currency: input.currency,
        billDate: input.billDate,
        source,
        status: 'done',
        localCount: localMap.size,
        localAmount,
        channelCount: channelMap.size,
        channelAmount,
        matchedCount: matched,
        diffCount,
        remark: input.remark ?? null,
        tenantId: scope.tenantId,
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
  const tenantId = requireTenantScopeId(currentUser());
  const [deleted] = await db
    .delete(paymentReconBatches)
    .where(and(
      eq(paymentReconBatches.id, id),
      exactTenantCondition(paymentReconBatches.tenantId, tenantId),
    ))
    .returning({ id: paymentReconBatches.id });
  requireRow(deleted, '对账批次不存在');
}

// ─── 差异处理流 ───────────────────────────────────────────────────────────────

type ReconAdjustment = { direction: 'in' | 'out'; amount: number };

/** 按本地可验证的差异推导调账方向与金额；渠道单边不能仅凭通用账单明细直接形成入账结论。 */
export function computeAdjustment(item: Pick<PaymentReconItemRow, 'result' | 'localAmount' | 'channelAmount'>): ReconAdjustment | null {
  if (item.result === 'amount_diff' && item.localAmount != null && item.channelAmount != null) {
    const delta = item.channelAmount - item.localAmount;
    if (delta === 0) return null;
    return { direction: delta > 0 ? 'in' : 'out', amount: Math.abs(delta) };
  }
  if (item.result === 'local_only' && item.localAmount != null && item.localAmount > 0) {
    return { direction: 'out', amount: item.localAmount };
  }
  return null;
}

/** 渠道下载账单已经过商户配置绑定与渠道适配器认证，可在人工确认后处理渠道单边入账。 */
function computeProviderAdjustment(item: Pick<PaymentReconItemRow, 'result' | 'localAmount' | 'channelAmount'>): ReconAdjustment | null {
  if (item.result === 'channel_only' && item.channelAmount != null && item.channelAmount > 0) {
    return { direction: 'in', amount: item.channelAmount };
  }
  return computeAdjustment(item);
}

/** 处理对账差异项：pending → adjusted/suspended/ignored（条件更新防重复处理）。
 * 选择「已调账」时将状态流转和双分录凭证放在同一事务内，避免出现已处理但未记账。 */
export async function handleReconItem(itemId: number, input: HandlePaymentReconItemInput): Promise<PaymentReconItem> {
  const user = currentUser();
  const tenantId = requireTenantScopeId(user);
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(paymentReconItems).where(eq(paymentReconItems.id, itemId)).limit(1);
    requireRow(item, '对账明细不存在');
    const [batch] = await tx
      .select()
      .from(paymentReconBatches)
      .where(and(
        eq(paymentReconBatches.id, item.batchId),
        exactTenantCondition(paymentReconBatches.tenantId, tenantId),
      ))
      .limit(1);
    requireRow(batch, '对账批次不存在');
    if (item.handleStatus == null) throw new HTTPException(400, { message: '该明细比对一致，无需处理' });
    if (input.action === 'adjusted' && batch.source !== 'provider_download') {
      throw new HTTPException(409, { message: '仅渠道下载账单可直接调账；人工上传和沙箱模拟账单只能挂账或忽略' });
    }
    const adjustment = input.action === 'adjusted' ? computeProviderAdjustment(item) : null;
    if (input.action === 'adjusted' && !adjustment) {
      throw new HTTPException(400, { message: '该差异缺少可调账金额，请选择挂账或忽略' });
    }

    const [maybeUpdated] = await tx
      .update(paymentReconItems)
      .set({ handleStatus: input.action, handleRemark: input.remark ?? null, handledAt: new Date(), handledById: user.userId })
      .where(and(eq(paymentReconItems.id, itemId), eq(paymentReconItems.handleStatus, 'pending')))
      .returning();
    const updated = requireRow(maybeUpdated, '该差异已被处理，请刷新后查看', 400);

    if (adjustment) {
      const amount = adjustment.amount.toString();
      await postSystemJournalWithin(tx, {
        tenantId: batch.tenantId ?? null,
        operatorId: user.userId,
        sourceType: 'recon.adjust',
        sourceId: String(item.id),
        description: `对账调账（批次 ${batch.batchNo}）：${input.remark}`,
        appId: batch.appId,
        channelConfigId: batch.channelConfigId,
        currency: batch.currency,
        lines: adjustment.direction === 'in'
          ? [
            { accountCode: 'suspense', debitAmount: amount, memo: '冲减待查资金' },
            { accountCode: 'merchant_available', creditAmount: amount, memo: '增加商户可用余额' },
          ]
          : [
            { accountCode: 'merchant_available', debitAmount: amount, memo: '扣减商户可用余额' },
            { accountCode: 'suspense', creditAmount: amount, memo: '增加待查资金' },
          ],
      });
    }
    return mapReconItem(updated);
  });
}

/** Demo/演示：用本地订单生成一份带表头的模拟渠道账单 CSV（金额取实付）。 */
export async function generateSampleBill(input: {
  applicationId: number;
  channel: PaymentChannel;
  channelConfigId: number;
  currency: string;
  billDate: string;
}): Promise<string> {
  const tenantId = requireTenantScopeId(currentUser());
  await ensureReconConfig(input.channelConfigId, input.channel, tenantId);
  await resolveReconApplication(input.channelConfigId, input.channel, tenantId, input.applicationId);
  const exactTenant = exactTenantCondition(paymentOrders.tenantId, tenantId);
  const rows = await loadLocalPaidRowsScoped(
    input.channel,
    input.applicationId,
    input.channelConfigId,
    input.currency,
    input.billDate,
    exactTenant,
  );
  const lines = ['订单号,渠道交易号,金额(分),状态'];
  for (const r of rows) {
    lines.push(`${r.orderNo},${r.channelTradeNo ?? ''},${r.paidAmount ?? r.amount},SUCCESS`);
  }
  return lines.join('\n');
}

// ─── 自动对账（拉取渠道账单）──────────────────────────────────────────────────

async function ensureReconConfig(id: number, channel: PaymentChannel, tenantId: number | null) {
  const exactTenant = exactTenantCondition(paymentChannelConfigs.tenantId, tenantId);
  const [maybeConfigRow] = await db
    .select()
    .from(paymentChannelConfigs)
    .where(and(
      eq(paymentChannelConfigs.id, id),
      eq(paymentChannelConfigs.channel, channel),
      eq(paymentChannelConfigs.status, 'enabled'),
      exactTenant,
    ))
    .limit(1);
  const configRow = requireRow(maybeConfigRow, '所选商户配置不存在、未启用或不属于当前租户', 400);
  return configRow;
}

async function resolveReconApplication(
  channelConfigId: number,
  channel: PaymentChannel,
  tenantId: number | null,
  expectedAppId?: number,
): Promise<number> {
  const exactTenant = exactTenantCondition(paymentApps.tenantId, tenantId);
  const channelBinding = channel === 'wechat'
    ? eq(paymentApps.wechatConfigId, channelConfigId)
    : channel === 'alipay'
      ? eq(paymentApps.alipayConfigId, channelConfigId)
      : eq(paymentApps.unionpayConfigId, channelConfigId);
  const rows = await db
    .select({ id: paymentApps.id })
    .from(paymentApps)
    .where(and(
      eq(paymentApps.status, 'enabled'),
      exactTenant,
      channelBinding,
      expectedAppId ? eq(paymentApps.id, expectedAppId) : undefined,
    ));
  if (rows.length === 0) throw new HTTPException(400, { message: '没有支付应用绑定所选商户配置' });
  if (rows.length > 1 && expectedAppId === undefined) {
    throw new HTTPException(400, { message: '多个支付应用绑定该商户配置，请明确指定 applicationId' });
  }
  return rows[0].id;
}

/** 自动拉取渠道账单并对账：sandbox 渠道用本地订单生成模拟账单（演示可闭环），
 * 真实渠道调 adapter.downloadBill（微信 tradebill；支付宝暂不支持自动拉取）。 */
export async function autoReconcile(input: {
  applicationId: number;
  channel: PaymentChannel;
  channelConfigId: number;
  currency: string;
  billDate: string;
}, scope: ReconScope): Promise<PaymentReconBatch> {
  const config = await ensureReconConfig(input.channelConfigId, input.channel, scope.tenantId);
  await resolveReconApplication(input.channelConfigId, input.channel, scope.tenantId, input.applicationId);

  let billText: string;
  let source: PaymentReconSource;
  let sourceRemark: string;
  if (config.sandbox) {
    // The local bill generator still observes the global payment engine gate.
    assertPaymentEngineConfig(config);
    const rows = await loadLocalPaidRowsScoped(input.channel, input.applicationId, config.id, input.currency, input.billDate, scope.orderWhere);
    const lines = ['订单号,渠道交易号,金额(分),状态'];
    for (const r of rows) lines.push(`${r.orderNo},${r.channelTradeNo ?? ''},${r.paidAmount ?? r.amount},SUCCESS`);
    billText = lines.join('\n');
    source = 'sandbox_generated';
    sourceRemark = '自动对账（沙箱模拟账单）';
  } else {
    // Never let a production-marked config bypass the effective environment
    // check when the process is running in sandbox/off mode.
    await assertEffectivePaymentOperation({ configRow: config, operation: 'bill.download', currency: input.currency });
    const adapter = getAdapter(input.channel);
    if (!adapter.downloadBill) throw new HTTPException(400, { message: `渠道 ${input.channel} 暂不支持自动拉取账单，请手动上传` });
    billText = await adapter.downloadBill(buildAdapterContext(config), input.billDate);
    source = 'provider_download';
    sourceRemark = '自动对账（渠道下载账单）';
  }
  return createReconBatchScoped({ ...input, remark: sourceRemark, billText }, scope, source);
}

/** 路由入口：按当前登录用户租户口径自动对账。 */
export async function autoReconcileForCurrentUser(input: {
  applicationId: number;
  channel: PaymentChannel;
  channelConfigId: number;
  currency: string;
  billDate: string;
}): Promise<PaymentReconBatch> {
  const user = currentUser();
  const tenantId = requireTenantScopeId(user);
  const orderWhere = exactTenantCondition(paymentOrders.tenantId, tenantId);
  return autoReconcile(input, { tenantId, orderWhere });
}

/** Cron：为昨日账期按租户与渠道自动对账；每个租户只使用自己的默认商户配置。 */
export async function autoReconcileYesterday(): Promise<{ generated: number; skipped: number }> {
  const billDate = formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  let generated = 0;
  let skipped = 0;
  const routes = await db
    .select({
      config: paymentChannelConfigs,
      applicationId: paymentApps.id,
    })
    .from(paymentApps)
    .innerJoin(paymentChannelConfigs, or(
      eq(paymentApps.wechatConfigId, paymentChannelConfigs.id),
      eq(paymentApps.alipayConfigId, paymentChannelConfigs.id),
      eq(paymentApps.unionpayConfigId, paymentChannelConfigs.id),
    ))
    .where(and(
      inArray(paymentChannelConfigs.channel, ['wechat', 'alipay']),
      eq(paymentChannelConfigs.status, 'enabled'),
      eq(paymentApps.status, 'enabled'),
    ));
  for (const { config, applicationId } of routes) {
    const { channel, tenantId } = config;
    const batchTenant = exactTenantCondition(paymentReconBatches.tenantId, tenantId);
    const exists = await db.$count(
      paymentReconBatches,
      and(
        eq(paymentReconBatches.channelConfigId, config.id),
        eq(paymentReconBatches.appId, applicationId),
        eq(paymentReconBatches.billDate, billDate),
        batchTenant,
      ),
    );
    if (exists > 0) {
      skipped++;
      continue;
    }
    try {
      const orderWhere = exactTenantCondition(paymentOrders.tenantId, tenantId);
      await autoReconcile({ applicationId, channel, channelConfigId: config.id, currency: 'CNY', billDate }, { tenantId, orderWhere });
      generated++;
    } catch (err) {
      skipped++;
      logger.warn('[payment-recon] auto reconcile skipped', { channel, billDate, err: err instanceof Error ? err.message : err });
    }
  }
  return { generated, skipped };
}
