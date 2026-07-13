/**
 * 签约代扣 Service（周期扣款/订阅）。
 *
 * 模型：扣款计划（paymentDeductPlans，周期/金额模板）+ 签约协议（paymentContracts）。
 * 扣款单复用 payment_orders（payMethod=wechat_papay/alipay_cycle，bizType/bizId 继承协议），
 * 成功走 markOrderPaid 完整履约链（计费/台账/outbox/webhook）。
 *
 * 状态机：pending → signed ⇄ paused → terminated。
 * 排期推进：扣款成功事件（payment.succeeded）订阅者原子推进 nextDeductAt（幂等，
 * 覆盖同步成功 / 异步查单补单 / 运营模拟支付三种路径）；扣款失败同步 failCount+1，
 * 次日重试，达到计划 maxRetries 自动暂停。
 * 资金安全：payment_orders 活跃业务单唯一索引保证同协议同一时刻至多一笔进行中扣款单。
 */
import { and, desc, eq, gte, inArray, isNull, like, lt, lte, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { randomInt } from 'node:crypto';
import dayjs from 'dayjs';
import { db } from '../../db';
import {
  paymentChannelConfigs,
  paymentContracts,
  paymentDeductPlans,
  paymentOrders,
  type PaymentChannelConfigRow,
  type PaymentContractRow,
  type PaymentDeductPlanRow,
  type PaymentOrderRow,
} from '../../db/schema';
import { config } from '../../config';
import { currentUserOrNull } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { isPgUniqueViolation } from '../../lib/db-errors';
import { getAdapter } from '../../lib/payment/registry';
import { paymentEventBus } from '../../lib/payment-event-bus';
import { recordEvent, processEvent } from './payment-outbox.service';
import { buildAdapterContext, markOrderPaid } from './payment.service';
import { pageOffset } from '../../lib/pagination';
import logger from '../../lib/logger';
import type {
  CreatePaymentContractInput,
  CreatePaymentDeductPlanInput,
  PaymentChannel,
  PaymentContract,
  PaymentContractStatus,
  PaymentDeductMethod,
  PaymentDeductPlan,
  UpdatePaymentDeductPlanInput,
} from '@zenith/shared';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_CHANNEL } from '@zenith/shared';

const ACTIVE_CONTRACT_STATUSES: PaymentContractStatus[] = ['pending', 'signed', 'paused'];

function genContractNo(): string {
  return `CT${Date.now()}${randomInt(1000, 9999)}`;
}

function genDeductOrderNo(): string {
  return `DED${Date.now()}${randomInt(1000, 9999)}`;
}

/** 按计划周期从基准时间推进一期（monthly 用自然月，避免固定 30 天漂移） */
export function advancePeriod(base: Date, plan: Pick<PaymentDeductPlanRow, 'period' | 'customDays'>): Date {
  const d = dayjs(base);
  switch (plan.period) {
    case 'daily':
      return d.add(1, 'day').toDate();
    case 'weekly':
      return d.add(1, 'week').toDate();
    case 'monthly':
      return d.add(1, 'month').toDate();
    case 'custom':
      return d.add(Math.max(1, plan.customDays ?? 1), 'day').toDate();
  }
}

/** 计划周期对应的 VIP 延长基准（与扣款排期同口径），供会员续费复用 */
export function advanceVipExpiry(base: Date, plan: Pick<PaymentDeductPlanRow, 'period' | 'customDays'>): Date {
  return advancePeriod(base, plan);
}

// ─── 映射 ─────────────────────────────────────────────────────────────────────

export function mapDeductPlan(row: PaymentDeductPlanRow & { contractCount?: number }): PaymentDeductPlan {
  return {
    id: row.id,
    name: row.name,
    period: row.period,
    customDays: row.customDays ?? null,
    amount: row.amount,
    maxRetries: row.maxRetries,
    status: row.status,
    remark: row.remark ?? null,
    contractCount: row.contractCount,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapContract(row: PaymentContractRow & { plan?: Pick<PaymentDeductPlanRow, 'name' | 'period' | 'amount'> | null }): PaymentContract {
  return {
    id: row.id,
    contractNo: row.contractNo,
    channel: row.channel,
    channelConfigId: row.channelConfigId ?? null,
    planId: row.planId,
    planName: row.plan?.name ?? null,
    planPeriod: row.plan?.period ?? null,
    planAmount: row.plan?.amount ?? null,
    signerAccount: row.signerAccount,
    signerName: row.signerName ?? null,
    status: row.status,
    channelContractNo: row.channelContractNo ?? null,
    bizType: row.bizType,
    bizId: row.bizId,
    nextDeductAt: formatNullableDateTime(row.nextDeductAt),
    lastDeductAt: formatNullableDateTime(row.lastDeductAt),
    failCount: row.failCount,
    totalDeductCount: row.totalDeductCount,
    lastOrderNo: row.lastOrderNo ?? null,
    signedAt: formatNullableDateTime(row.signedAt),
    terminatedAt: formatNullableDateTime(row.terminatedAt),
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 扣款计划 CRUD ────────────────────────────────────────────────────────────

export interface ListDeductPlansQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'enabled' | 'disabled';
}

function plansTenantCondition() {
  const user = currentUserOrNull();
  return user ? tenantCondition(paymentDeductPlans, user) : undefined;
}

export async function listDeductPlans(q: ListDeductPlansQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  if (q.keyword) conds.push(like(paymentDeductPlans.name, `%${escapeLike(q.keyword)}%`));
  if (q.status) conds.push(eq(paymentDeductPlans.status, q.status));
  const where = mergeWhere(conds.length ? and(...conds) : undefined, plansTenantCondition());
  const [total, rows] = await Promise.all([
    db.$count(paymentDeductPlans, where),
    withPagination(
      db
        .select({
          plan: paymentDeductPlans,
          contractCount: sql<number>`(select count(*)::int from ${paymentContracts} where ${paymentContracts.planId} = ${paymentDeductPlans.id})`,
        })
        .from(paymentDeductPlans)
        .where(where)
        .orderBy(desc(paymentDeductPlans.id))
        .$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return { list: rows.map((r) => mapDeductPlan({ ...r.plan, contractCount: r.contractCount })), total, page, pageSize };
}

/** 全量启用中的扣款计划（下拉/前台可选） */
export async function allDeductPlans(): Promise<PaymentDeductPlan[]> {
  const rows = await db
    .select()
    .from(paymentDeductPlans)
    .where(mergeWhere(eq(paymentDeductPlans.status, 'enabled'), plansTenantCondition()))
    .orderBy(paymentDeductPlans.id);
  return rows.map((r) => mapDeductPlan(r));
}

export async function ensureDeductPlan(id: number): Promise<PaymentDeductPlanRow> {
  const [row] = await db.select().from(paymentDeductPlans).where(and(eq(paymentDeductPlans.id, id), plansTenantCondition())).limit(1);
  if (!row) throw new HTTPException(404, { message: '扣款计划不存在' });
  return row;
}

export async function createDeductPlan(input: CreatePaymentDeductPlanInput): Promise<PaymentDeductPlan> {
  const user = currentUserOrNull();
  const [row] = await db
    .insert(paymentDeductPlans)
    .values({
      name: input.name,
      period: input.period,
      customDays: input.period === 'custom' ? (input.customDays ?? null) : null,
      amount: input.amount,
      maxRetries: input.maxRetries,
      status: input.status,
      remark: input.remark ?? null,
      tenantId: user?.tenantId ?? null,
    })
    .returning();
  return mapDeductPlan(row);
}

export async function updateDeductPlan(id: number, input: UpdatePaymentDeductPlanInput): Promise<PaymentDeductPlan> {
  const before = await ensureDeductPlan(id);
  const period = input.period ?? before.period;
  const [row] = await db
    .update(paymentDeductPlans)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.period !== undefined ? { period: input.period } : {}),
      customDays: period === 'custom' ? (input.customDays !== undefined ? input.customDays : before.customDays) : null,
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.maxRetries !== undefined ? { maxRetries: input.maxRetries } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.remark !== undefined ? { remark: input.remark } : {}),
    })
    .where(eq(paymentDeductPlans.id, id))
    .returning();
  if (period === 'custom' && row.customDays == null) throw new HTTPException(400, { message: '自定义周期必须填写天数' });
  return mapDeductPlan(row);
}

export async function deleteDeductPlan(id: number): Promise<void> {
  await ensureDeductPlan(id);
  const refs = await db.$count(paymentContracts, eq(paymentContracts.planId, id));
  if (refs > 0) throw new HTTPException(400, { message: `该计划已被 ${refs} 份签约协议引用，无法删除` });
  await db.delete(paymentDeductPlans).where(eq(paymentDeductPlans.id, id));
}

// ─── 协议查询 ─────────────────────────────────────────────────────────────────

export interface ListContractsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: PaymentContractStatus;
  channel?: PaymentChannel;
  planId?: number;
  bizType?: string;
  startTime?: string;
  endTime?: string;
}

function contractsTenantCondition() {
  const user = currentUserOrNull();
  return user ? tenantCondition(paymentContracts, user) : undefined;
}

export async function buildContractsWhere(q: ListContractsQuery) {
  const conds = [];
  if (q.keyword) {
    const kw = `%${escapeLike(q.keyword)}%`;
    conds.push(or(like(paymentContracts.contractNo, kw), like(paymentContracts.signerAccount, kw), like(paymentContracts.bizId, kw)));
  }
  if (q.status) conds.push(eq(paymentContracts.status, q.status));
  if (q.channel) conds.push(eq(paymentContracts.channel, q.channel));
  if (q.planId) conds.push(eq(paymentContracts.planId, q.planId));
  if (q.bizType) conds.push(eq(paymentContracts.bizType, q.bizType));
  const start = parseDateRangeStart(q.startTime);
  const end = parseDateRangeEnd(q.endTime);
  if (start) conds.push(gte(paymentContracts.createdAt, start));
  if (end) conds.push(lte(paymentContracts.createdAt, end));
  return mergeWhere(conds.length ? and(...conds) : undefined, contractsTenantCondition());
}

export async function listContracts(q: ListContractsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const where = await buildContractsWhere(q);
  const [total, rows] = await Promise.all([
    db.$count(paymentContracts, where),
    db.query.paymentContracts.findMany({
      where,
      with: { plan: { columns: { name: true, period: true, amount: true } } },
      orderBy: desc(paymentContracts.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  return { list: rows.map(mapContract), total, page, pageSize };
}

export async function ensureContract(id: number): Promise<PaymentContractRow> {
  const [row] = await db.select().from(paymentContracts).where(and(eq(paymentContracts.id, id), contractsTenantCondition())).limit(1);
  if (!row) throw new HTTPException(404, { message: '签约协议不存在' });
  return row;
}

export async function getContract(id: number): Promise<PaymentContract> {
  const row = await db.query.paymentContracts.findFirst({
    where: mergeWhere(eq(paymentContracts.id, id), contractsTenantCondition()),
    with: { plan: { columns: { name: true, period: true, amount: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '签约协议不存在' });
  return mapContract(row);
}

/** 查询业务单的活跃协议（会员续费等业务入口用，不带管理端租户条件） */
export async function findActiveContractByBiz(bizType: string, bizId: string): Promise<PaymentContractRow | null> {
  const [row] = await db
    .select()
    .from(paymentContracts)
    .where(and(eq(paymentContracts.bizType, bizType), eq(paymentContracts.bizId, bizId), inArray(paymentContracts.status, ACTIVE_CONTRACT_STATUSES)))
    .limit(1);
  return row ?? null;
}

// ─── 渠道配置解析（不依赖管理员上下文，可在会员/cron 场景使用）────────────────

function channelConfigTenantCondition(tenantId: number | null | undefined) {
  if (tenantId === undefined || !config.multiTenantMode) return undefined;
  return tenantId === null ? isNull(paymentChannelConfigs.tenantId) : eq(paymentChannelConfigs.tenantId, tenantId);
}

async function resolveContractConfig(channel: PaymentChannel, channelConfigId?: number | null, tenantId?: number | null): Promise<PaymentChannelConfigRow> {
  if (channelConfigId) {
    const [row] = await db.select().from(paymentChannelConfigs).where(eq(paymentChannelConfigs.id, channelConfigId)).limit(1);
    if (!row) throw new HTTPException(404, { message: '支付渠道配置不存在' });
    return row;
  }
  const [row] = await db
    .select()
    .from(paymentChannelConfigs)
    .where(
      mergeWhere(
        and(eq(paymentChannelConfigs.channel, channel), eq(paymentChannelConfigs.isDefault, true), eq(paymentChannelConfigs.status, 'enabled')),
        channelConfigTenantCondition(tenantId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(400, { message: `未配置默认${PAYMENT_CHANNEL_LABELS[channel]}支付渠道` });
  return row;
}

// ─── 签约 / 解约 / 暂停 / 恢复 ────────────────────────────────────────────────

export interface SignContractInput {
  planId: number;
  payMethod: PaymentDeductMethod;
  channelConfigId?: number;
  signerAccount: string;
  signerName?: string;
  bizType: string;
  bizId: string;
  remark?: string;
  tenantId?: number | null;
  /** 签约成功后立即执行首期扣款 */
  firstDeductNow?: boolean;
}

export interface SignContractResult {
  contract: PaymentContract;
  firstDeduct?: DeductResult | null;
}

/** 创建协议并调渠道签约（sandbox 即时生效）；可选立即首扣。业务入口（管理端/会员端）共用。 */
export async function signContract(input: SignContractInput): Promise<SignContractResult> {
  const plan = await db.query.paymentDeductPlans.findFirst({ where: eq(paymentDeductPlans.id, input.planId) });
  if (!plan) throw new HTTPException(404, { message: '扣款计划不存在' });
  if (plan.status !== 'enabled') throw new HTTPException(400, { message: '扣款计划已停用' });

  const channel = PAYMENT_METHOD_CHANNEL[input.payMethod];
  const existing = await findActiveContractByBiz(input.bizType, input.bizId);
  if (existing) throw new HTTPException(400, { message: `该业务已存在生效中的签约协议（${existing.contractNo}）` });

  const contractConfig = await resolveContractConfig(channel, input.channelConfigId, input.tenantId);
  const adapter = getAdapter(channel);
  if (!adapter.signContract) throw new HTTPException(400, { message: `渠道 ${channel} 暂不支持签约代扣` });

  const contractNo = genContractNo();
  let row: PaymentContractRow;
  try {
    [row] = await db
      .insert(paymentContracts)
      .values({
        contractNo,
        channel,
        channelConfigId: contractConfig.id,
        planId: plan.id,
        signerAccount: input.signerAccount,
        signerName: input.signerName ?? null,
        status: 'pending',
        bizType: input.bizType,
        bizId: input.bizId,
        remark: input.remark ?? null,
        tenantId: input.tenantId ?? null,
      })
      .returning();
  } catch (err) {
    if (isPgUniqueViolation(err)) throw new HTTPException(400, { message: '该业务已存在生效中的签约协议' });
    throw err;
  }

  try {
    const res = await adapter.signContract(buildAdapterContext(contractConfig), {
      outContractNo: contractNo,
      signerAccount: input.signerAccount,
      planName: plan.name,
      amount: plan.amount,
      period: plan.period,
    });
    if (res.status === 'signed') {
      [row] = await db
        .update(paymentContracts)
        .set({
          status: 'signed',
          channelContractNo: res.channelContractNo ?? null,
          signedAt: new Date(),
          // 首扣立即执行时排期为当下；否则从签约时间推进一个周期
          nextDeductAt: input.firstDeductNow ? new Date() : advancePeriod(new Date(), plan),
        })
        .where(eq(paymentContracts.id, row.id))
        .returning();
    }
  } catch (err) {
    // 渠道签约失败：协议尚无任何资金记录，直接清除占位，避免阻塞重新签约
    await db.delete(paymentContracts).where(and(eq(paymentContracts.id, row.id), eq(paymentContracts.status, 'pending')));
    throw err;
  }

  let firstDeduct: DeductResult | null = null;
  if (input.firstDeductNow && row.status === 'signed') {
    try {
      firstDeduct = await executeDeduction(row);
      row = await ensureContractByNo(row.contractNo);
    } catch (err) {
      logger.warn('[payment-contract] first deduct failed', { contractNo: row.contractNo, err: err instanceof Error ? err.message : err });
    }
  }
  return { contract: mapContract({ ...row, plan }), firstDeduct };
}

async function ensureContractByNo(contractNo: string): Promise<PaymentContractRow> {
  const [row] = await db.select().from(paymentContracts).where(eq(paymentContracts.contractNo, contractNo)).limit(1);
  if (!row) throw new HTTPException(404, { message: '签约协议不存在' });
  return row;
}

/** 管理端创建签约（演示/测试）：bizType=admin_contract，bizId=协议号自身（不与业务单冲突） */
export async function adminCreateContract(input: CreatePaymentContractInput): Promise<SignContractResult> {
  const user = currentUserOrNull();
  const bizId = `ADM${Date.now()}${randomInt(100, 999)}`;
  return signContract({
    planId: input.planId,
    payMethod: input.payMethod,
    channelConfigId: input.channelConfigId,
    signerAccount: input.signerAccount,
    signerName: input.signerName,
    bizType: 'admin_contract',
    bizId,
    remark: input.remark,
    tenantId: user?.tenantId ?? null,
    firstDeductNow: input.firstDeductNow,
  });
}

/** 解约（渠道解约成功后本地终态；pending/signed/paused 均可解约） */
export async function terminateContract(row: PaymentContractRow): Promise<PaymentContract> {
  if (row.status === 'terminated') throw new HTTPException(400, { message: '协议已解约' });
  const contractConfig = await resolveContractConfig(row.channel, row.channelConfigId, row.tenantId);
  const adapter = getAdapter(row.channel);
  if (adapter.terminateContract) {
    await adapter.terminateContract(buildAdapterContext(contractConfig), {
      outContractNo: row.contractNo,
      channelContractNo: row.channelContractNo ?? undefined,
    });
  }
  const [updated] = await db
    .update(paymentContracts)
    .set({ status: 'terminated', terminatedAt: new Date(), nextDeductAt: null })
    .where(eq(paymentContracts.id, row.id))
    .returning();
  return mapContract(updated);
}

export async function pauseContract(id: number): Promise<PaymentContract> {
  const row = await ensureContract(id);
  if (row.status !== 'signed') throw new HTTPException(400, { message: '仅已签约协议可暂停' });
  const [updated] = await db.update(paymentContracts).set({ status: 'paused' }).where(and(eq(paymentContracts.id, id), eq(paymentContracts.status, 'signed'))).returning();
  if (!updated) throw new HTTPException(400, { message: '协议状态已变化，请刷新后重试' });
  return mapContract(updated);
}

export async function resumeContract(id: number): Promise<PaymentContract> {
  const row = await ensureContract(id);
  if (row.status !== 'paused') throw new HTTPException(400, { message: '仅已暂停协议可恢复' });
  const [updated] = await db
    .update(paymentContracts)
    .set({ status: 'signed', failCount: 0, nextDeductAt: new Date() })
    .where(and(eq(paymentContracts.id, id), eq(paymentContracts.status, 'paused')))
    .returning();
  if (!updated) throw new HTTPException(400, { message: '协议状态已变化，请刷新后重试' });
  return mapContract(updated);
}

// ─── 扣款执行 ─────────────────────────────────────────────────────────────────

export interface DeductResult {
  orderNo: string | null;
  deductStatus: 'success' | 'processing' | 'failed';
  failReason?: string | null;
}

/** 记录扣款失败：failCount+1，达上限自动暂停，否则次日重试 */
async function recordDeductFailure(row: PaymentContractRow, plan: PaymentDeductPlanRow, reason: string): Promise<void> {
  const failCount = row.failCount + 1;
  const paused = failCount >= plan.maxRetries;
  await db
    .update(paymentContracts)
    .set({
      failCount,
      ...(paused ? { status: 'paused' as const, nextDeductAt: null } : { nextDeductAt: dayjs().add(1, 'day').toDate() }),
    })
    .where(and(eq(paymentContracts.id, row.id), eq(paymentContracts.status, 'signed')));
  logger.warn('[payment-contract] deduct failed', { contractNo: row.contractNo, failCount, paused, reason });
}

/** 扣款失败订单落终态 + 可靠发 payment.failed 事件（与 createPayment 失败分支同模式） */
async function markDeductOrderFailed(order: PaymentOrderRow, reason: string): Promise<void> {
  const eventId = await db.transaction(async (tx) => {
    await tx.update(paymentOrders).set({ status: 'failed', errorMessage: reason.slice(0, 500) }).where(eq(paymentOrders.id, order.id));
    return recordEvent(tx, {
      type: 'payment.failed',
      orderNo: order.orderNo,
      tenantId: order.tenantId,
      payload: {
        type: 'payment.failed',
        orderNo: order.orderNo,
        outTradeNo: order.outTradeNo,
        bizType: order.bizType,
        bizId: order.bizId,
        channel: order.channel,
        amount: order.amount,
        userId: order.userId,
        tenantId: order.tenantId,
      },
    });
  });
  setImmediate(() => { void processEvent(eventId); });
}

/**
 * 执行一期扣款（cron 到期扫描 / 管理端补扣 / 签约首扣共用）。
 * 并发安全：payment_orders 活跃业务单唯一索引兜底，同协议并发扣款仅一笔能落单。
 */
export async function executeDeduction(input: PaymentContractRow): Promise<DeductResult> {
  const row = await ensureContractByNo(input.contractNo);
  if (row.status !== 'signed') throw new HTTPException(400, { message: '仅已签约协议可执行扣款' });
  if (!row.channelContractNo) throw new HTTPException(400, { message: '协议缺少渠道协议号，无法扣款' });
  const plan = await db.query.paymentDeductPlans.findFirst({ where: eq(paymentDeductPlans.id, row.planId) });
  if (!plan) throw new HTTPException(404, { message: '扣款计划不存在' });

  const contractConfig = await resolveContractConfig(row.channel, row.channelConfigId, row.tenantId);
  const adapter = getAdapter(row.channel);
  if (!adapter.deductContract) throw new HTTPException(400, { message: `渠道 ${row.channel} 暂不支持代扣` });

  const orderNo = genDeductOrderNo();
  const payMethod = row.channel === 'wechat' ? ('wechat_papay' as const) : ('alipay_cycle' as const);
  let order: PaymentOrderRow;
  try {
    [order] = await db
      .insert(paymentOrders)
      .values({
        orderNo,
        outTradeNo: orderNo,
        bizType: row.bizType,
        bizId: row.bizId,
        subject: `${plan.name}（第 ${row.totalDeductCount + 1} 期代扣）`,
        body: `签约协议 ${row.contractNo}`,
        amount: plan.amount,
        currency: 'CNY',
        channel: row.channel,
        channelConfigId: contractConfig.id,
        payMethod,
        status: 'pending',
        expiredAt: dayjs().add(30, 'minute').toDate(),
        tenantId: row.tenantId,
      })
      .returning();
  } catch (err) {
    if (isPgUniqueViolation(err)) throw new HTTPException(400, { message: '该协议存在处理中的扣款订单，请稍后重试' });
    throw err;
  }

  // 先记录本期订单号，成功事件订阅者按 lastOrderNo 幂等推进排期
  await db.update(paymentContracts).set({ lastOrderNo: orderNo }).where(eq(paymentContracts.id, row.id));

  try {
    const res = await adapter.deductContract(buildAdapterContext(contractConfig), {
      channelContractNo: row.channelContractNo,
      outTradeNo: orderNo,
      amount: plan.amount,
      subject: `${plan.name} 周期扣款`,
    });
    if (res.status === 'success') {
      await markOrderPaid(order, { channelTradeNo: res.channelTradeNo, paidAmount: plan.amount, paidAt: new Date() });
      return { orderNo, deductStatus: 'success' };
    }
    if (res.status === 'processing') {
      // 渠道受理中：置 paying，由 paymentReconciliation cron 查单收敛，成功事件推进排期
      await db.update(paymentOrders).set({ status: 'paying', channelTradeNo: res.channelTradeNo ?? null }).where(eq(paymentOrders.id, order.id));
      return { orderNo, deductStatus: 'processing' };
    }
    const reason = res.failReason ?? '渠道扣款失败';
    await markDeductOrderFailed(order, reason);
    await recordDeductFailure(row, plan, reason);
    return { orderNo, deductStatus: 'failed', failReason: reason };
  } catch (err) {
    const reason = (err instanceof Error ? err.message : '渠道扣款请求失败').slice(0, 500);
    await markDeductOrderFailed(order, reason);
    await recordDeductFailure(row, plan, reason);
    return { orderNo, deductStatus: 'failed', failReason: reason };
  }
}

/** 管理端按协议 id 手动补扣 */
export async function deductContractById(id: number): Promise<DeductResult & { contract: PaymentContract }> {
  const row = await ensureContract(id);
  const result = await executeDeduction(row);
  return { ...result, contract: await getContract(id) };
}

/** Cron：扫描到期协议执行扣款，返回处理条数 */
export async function executeDueDeductions(): Promise<number> {
  const rows = await db
    .select()
    .from(paymentContracts)
    .where(and(eq(paymentContracts.status, 'signed'), lte(paymentContracts.nextDeductAt, new Date())))
    .orderBy(paymentContracts.nextDeductAt)
    .limit(50);
  let processed = 0;
  for (const row of rows) {
    try {
      await executeDeduction(row);
      processed += 1;
    } catch (err) {
      logger.error('[payment-contract] due deduction failed', { contractNo: row.contractNo, err: err instanceof Error ? err.message : err });
    }
  }
  return processed;
}

// ─── 排期推进（支付成功事件订阅者，幂等）──────────────────────────────────────

/**
 * 扣款单支付成功后原子推进协议排期。
 * 按订单 bizType+bizId 定位生效协议（不依赖 lastOrderNo，连续扣款下事件重投也不丢推进）；
 * 幂等锚点为订单 paidAt：仅当 lastDeductAt 早于该单支付时间时生效，
 * outbox 重投 / 查单补单 / 运营模拟支付多路径安全。
 */
export async function advanceContractOnPaid(event: { orderNo: string; bizType: string; bizId: string }): Promise<void> {
  const [row] = await db
    .select()
    .from(paymentContracts)
    .where(and(eq(paymentContracts.bizType, event.bizType), eq(paymentContracts.bizId, event.bizId), eq(paymentContracts.status, 'signed')))
    .limit(1);
  if (!row) return;
  const [order] = await db
    .select({ paidAt: paymentOrders.paidAt, status: paymentOrders.status, payMethod: paymentOrders.payMethod })
    .from(paymentOrders)
    .where(eq(paymentOrders.orderNo, event.orderNo))
    .limit(1);
  if (!order || order.status !== 'success' || !order.paidAt) return;
  // 仅代扣单推进排期（同业务的普通支付单，如手动购买，不影响协议周期）
  if (order.payMethod !== 'wechat_papay' && order.payMethod !== 'alipay_cycle') return;
  const plan = await db.query.paymentDeductPlans.findFirst({ where: eq(paymentDeductPlans.id, row.planId) });
  if (!plan) return;
  const next = advancePeriod(new Date(), plan);
  await db
    .update(paymentContracts)
    .set({
      nextDeductAt: next,
      lastDeductAt: order.paidAt,
      failCount: 0,
      totalDeductCount: sql`${paymentContracts.totalDeductCount} + 1`,
    })
    .where(
      and(
        eq(paymentContracts.id, row.id),
        eq(paymentContracts.status, 'signed'),
        or(isNull(paymentContracts.lastDeductAt), lt(paymentContracts.lastDeductAt, order.paidAt)),
      ),
    );
}

let contractSubscribersRegistered = false;

/** 订阅支付成功事件推进协议排期（幂等，可重复调用注册一次） */
export function registerContractSubscribers(): void {
  if (contractSubscribersRegistered) return;
  contractSubscribersRegistered = true;
  paymentEventBus.on('payment.succeeded', async (e) => {
    await advanceContractOnPaid({ orderNo: e.orderNo, bizType: e.bizType, bizId: e.bizId });
  });
  logger.info('Payment contract subscribers registered');
}
