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
import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { randomInt } from 'node:crypto';
import dayjs from 'dayjs';
import { db } from '../../db';
import { buildListResult } from '../../lib/list-query';
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
import { requireRow } from '../../lib/db-assert';
import { currentUser, currentUserOrNull } from '../../lib/context';
import { requireTenantScopeId, tenantCondition, exactTenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import { isPgUniqueViolation } from '../../lib/db-errors';
import { getAdapter } from '../../lib/payment';
import { paymentEventBus } from '../../lib/payment-event-bus';
import { recordEvent, processEvent } from './payment-outbox.service';
import { buildAdapterContext, markOrderPaid, syncOrderStatus } from './payment.service';
import { resolveApplicationChannelConfig } from './payment-apps.service';
import { assertEffectivePaymentOperation } from './payment-capability-evaluator';
import { pageOffset } from '../../lib/pagination';
import logger from '../../lib/logger';
import type { CreatePaymentContractInput, CreatePaymentDeductPlanInput, PaymentChannel, PaymentContract, PaymentContractStatus, PaymentDeductMethod, PaymentDeductPlan, UpdatePaymentDeductPlanInput } from '@zenith/shared/payment';
import { PAYMENT_METHOD_CHANNEL } from '@zenith/shared/payment';

const ACTIVE_CONTRACT_STATUSES: PaymentContractStatus[] = ['pending', 'unknown', 'signed', 'paused'];

function genContractNo(): string {
  return `CT${Date.now()}${randomInt(1000, 9999)}`;
}

/**
 * A deduction order is the durable idempotency key for one contract period.
 * It must remain stable across process crashes and retries; a random order
 * number would allow the same period to be charged twice after a timeout.
 */
function genDeductOrderNo(contractId: number, sequence: number): string {
  return `DED${contractId}-${sequence}`;
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
    channelConfigId: row.channelConfigId,
    appId: row.appId,
    currency: row.currency,
    planId: row.planId,
    planName: row.plan?.name ?? null,
    planPeriod: row.plan?.period ?? null,
    planAmount: row.plan?.amount ?? null,
    signerAccount: row.signerAccount,
    signerName: row.signerName ?? null,
    status: row.status,
    unknownOperation: row.unknownOperation ?? null,
    version: row.version,
    errorMessage: row.errorMessage ?? null,
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
  conds.push(keywordCondition(q.keyword, [paymentDeductPlans.name]));
  if (q.status) conds.push(eq(paymentDeductPlans.status, q.status));
  const where = buildWhere(...conds, plansTenantCondition());
  // 有效签约数（signed/paused）按计划分组后 LEFT JOIN。
  // 禁止在 sql`` 模板里做裸 Column 跨表比较（如 where ${a.planId} = ${b.id}）——
  // drizzle 渲染裸列名不带表限定，子查询内会自解析成恒真/自比较条件。
  const contractCounts = db
    .select({ planId: paymentContracts.planId, cnt: sql<number>`count(*)::int`.as('cnt') })
    .from(paymentContracts)
    .where(inArray(paymentContracts.status, ['signed', 'paused']))
    .groupBy(paymentContracts.planId)
    .as('contract_counts');
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentDeductPlans, where),
    rows: () => withPagination(
      db
        .select({
          plan: paymentDeductPlans,
          contractCount: sql<number>`coalesce(${contractCounts.cnt}, 0)`,
        })
        .from(paymentDeductPlans)
        .leftJoin(contractCounts, eq(contractCounts.planId, paymentDeductPlans.id))
        .where(where)
        .orderBy(desc(paymentDeductPlans.id))
        .$dynamic(),
      page,
      pageSize,
    ),
    map: (r) => mapDeductPlan({ ...r.plan, contractCount: r.contractCount }),
  });
}

/** 全量启用中的扣款计划（下拉/前台可选） */
export async function allDeductPlans(scope?: { tenantId: number | null }): Promise<PaymentDeductPlan[]> {
  const exactScope = scope
    ? (exactTenantCondition(paymentDeductPlans.tenantId, scope.tenantId))
    : plansTenantCondition();
  const rows = await db
    .select()
    .from(paymentDeductPlans)
    .where(buildWhere(eq(paymentDeductPlans.status, 'enabled'), exactScope))
    .orderBy(paymentDeductPlans.id);
  return rows.map((r) => mapDeductPlan(r));
}

export async function ensureDeductPlan(id: number): Promise<PaymentDeductPlanRow> {
  const [row] = await db.select().from(paymentDeductPlans).where(and(eq(paymentDeductPlans.id, id), plansTenantCondition())).limit(1);
  requireRow(row, '扣款计划不存在');
  return row;
}

export async function createDeductPlan(input: CreatePaymentDeductPlanInput): Promise<PaymentDeductPlan> {
  const tenantId = requireTenantScopeId(currentUser());
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
      tenantId,
    })
    .returning();
  return mapDeductPlan(row);
}

export async function updateDeductPlan(id: number, input: UpdatePaymentDeductPlanInput): Promise<PaymentDeductPlan> {
  requireTenantScopeId(currentUser());
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
  requireTenantScopeId(currentUser());
  await ensureDeductPlan(id);
  const refs = await db.$count(paymentContracts, eq(paymentContracts.planId, id));
  if (refs > 0) throw new HTTPException(400, { message: `该计划已被 ${refs} 份签约协议引用，无法删除` });
  await db.delete(paymentDeductPlans).where(eq(paymentDeductPlans.id, id));
}

// ─── 协议查询 ─────────────────────────────────────────────────────────────────

export interface ListContractsQuery {
  page?: number;
  pageSize?: number;
  applicationId: number;
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
  const conds: Array<SQL | undefined> = [eq(paymentContracts.appId, q.applicationId)];
  conds.push(keywordCondition(q.keyword, [paymentContracts.contractNo, paymentContracts.signerAccount, paymentContracts.bizId]));
  if (q.status) conds.push(eq(paymentContracts.status, q.status));
  if (q.channel) conds.push(eq(paymentContracts.channel, q.channel));
  if (q.planId) conds.push(eq(paymentContracts.planId, q.planId));
  if (q.bizType) conds.push(eq(paymentContracts.bizType, q.bizType));
  const start = parseDateRangeStart(q.startTime);
  const end = parseDateRangeEnd(q.endTime);
  if (start) conds.push(gte(paymentContracts.createdAt, start));
  if (end) conds.push(lte(paymentContracts.createdAt, end));
  return buildWhere(...conds, contractsTenantCondition());
}

export async function listContracts(q: ListContractsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const where = await buildContractsWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentContracts, where),
    rows: () => db.query.paymentContracts.findMany({
      where,
      with: { plan: { columns: { name: true, period: true, amount: true } } },
      orderBy: desc(paymentContracts.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    map: mapContract,
  });
}

export async function ensureContract(id: number, applicationId: number): Promise<PaymentContractRow> {
  const [row] = await db.select().from(paymentContracts).where(and(
    eq(paymentContracts.id, id),
    eq(paymentContracts.appId, applicationId),
    contractsTenantCondition(),
  )).limit(1);
  requireRow(row, '签约协议不存在');
  return row;
}

/** 管理端写操作读取：禁止平台全量视角直接修改任一租户协议。 */
export async function ensureWritableContract(id: number, applicationId: number): Promise<PaymentContractRow> {
  requireTenantScopeId(currentUser());
  return ensureContract(id, applicationId);
}

export async function getContract(id: number, applicationId: number): Promise<PaymentContract> {
  const row = requireRow(await db.query.paymentContracts.findFirst({
    where: buildWhere(and(eq(paymentContracts.id, id), eq(paymentContracts.appId, applicationId)), contractsTenantCondition()),
    with: { plan: { columns: { name: true, period: true, amount: true } } },
  }), '签约协议不存在');
  return mapContract(row);
}

/** 查询业务单的活跃协议，调用方必须提供完整租户/应用/币种作用域。 */
export async function findActiveContractByBiz(input: {
  bizType: string;
  bizId: string;
  tenantId: number | null;
  applicationId: number;
  currency: string;
}): Promise<PaymentContractRow | null> {
  const [row] = await db
    .select()
    .from(paymentContracts)
    .where(and(
      eq(paymentContracts.bizType, input.bizType),
      eq(paymentContracts.bizId, input.bizId),
      eq(paymentContracts.appId, input.applicationId),
      eq(paymentContracts.currency, input.currency),
      exactTenantCondition(paymentContracts.tenantId, input.tenantId),
      inArray(paymentContracts.status, ACTIVE_CONTRACT_STATUSES),
    ))
    .limit(1);
  return row ?? null;
}

async function loadContractConfig(row: Pick<PaymentContractRow, 'channel' | 'channelConfigId' | 'tenantId'>): Promise<PaymentChannelConfigRow> {
  const [maybeConfig] = await db.select().from(paymentChannelConfigs).where(and(
    eq(paymentChannelConfigs.id, row.channelConfigId),
    eq(paymentChannelConfigs.channel, row.channel),
    exactTenantCondition(paymentChannelConfigs.tenantId, row.tenantId),
  )).limit(1);
  const config = requireRow(maybeConfig, '协议绑定的商户配置不存在或作用域不一致', 409);
  return config;
}

async function assertContractOperation(
  config: PaymentChannelConfigRow,
  operation: 'contract.sign' | 'contract.query' | 'contract.terminate' | 'contract.deduct',
  method: PaymentDeductMethod,
  currency: string,
  recovery = false,
) {
  return assertEffectivePaymentOperation({ configRow: config, operation, method: operation === 'contract.query' ? undefined : method, currency, recovery });
}

// ─── 签约 / 解约 / 暂停 / 恢复 ────────────────────────────────────────────────

export interface SignContractInput {
  applicationId: number;
  planId: number;
  payMethod: PaymentDeductMethod;
  currency: string;
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
  const user = currentUserOrNull();
  let tenantId: number | null;
  if (input.tenantId !== undefined) {
    tenantId = input.tenantId;
  } else {
    if (!user) throw new HTTPException(500, { message: '内部签约必须显式提供租户作用域' });
    tenantId = requireTenantScopeId(user);
  }
  const channel = PAYMENT_METHOD_CHANNEL[input.payMethod];
  const application = await resolveApplicationChannelConfig(input.applicationId, channel, tenantId);
  const [maybeContractConfig] = await db.select().from(paymentChannelConfigs).where(and(
    eq(paymentChannelConfigs.id, application.channelConfigId),
    exactTenantCondition(paymentChannelConfigs.tenantId, tenantId),
  )).limit(1);
  const contractConfig = requireRow(maybeContractConfig, '支付应用绑定的商户配置不存在', 400);
  await assertContractOperation(contractConfig, 'contract.sign', input.payMethod, input.currency);
  const adapter = getAdapter(channel);
  if (!adapter.signContract) throw new HTTPException(400, { message: `CAPABILITY_UNSUPPORTED: ${channel}/contract.sign` });

  const plan = requireRow(await db.query.paymentDeductPlans.findFirst({
    where: and(
      eq(paymentDeductPlans.id, input.planId),
      exactTenantCondition(paymentDeductPlans.tenantId, tenantId),
    ),
  }), '扣款计划不存在');
  if (plan.status !== 'enabled') throw new HTTPException(400, { message: '扣款计划已停用' });
  const existing = await findActiveContractByBiz({
    bizType: input.bizType,
    bizId: input.bizId,
    tenantId,
    applicationId: application.appId,
    currency: input.currency,
  });
  if (existing) throw new HTTPException(400, { message: `该业务已存在生效中的签约协议（${existing.contractNo}）` });

  const contractNo = genContractNo();
  let row: PaymentContractRow;
  try {
    [row] = await db
      .insert(paymentContracts)
      .values({
        contractNo,
        channel,
        channelConfigId: contractConfig.id,
        appId: application.appId,
        currency: input.currency,
        planId: plan.id,
        signerAccount: input.signerAccount,
        signerName: input.signerName ?? null,
        status: 'pending',
        unknownOperation: 'sign',
        bizType: input.bizType,
        bizId: input.bizId,
        remark: input.remark ?? null,
        tenantId,
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
      const [signed] = await db
        .update(paymentContracts)
        .set({
          status: 'signed',
          unknownOperation: null,
          channelContractNo: res.channelContractNo ?? null,
          signedAt: new Date(),
          errorMessage: null,
          version: sql`${paymentContracts.version} + 1`,
          // 首扣立即执行时排期为当下；否则从签约时间推进一个周期
          nextDeductAt: input.firstDeductNow ? new Date() : advancePeriod(new Date(), plan),
        })
        .where(and(eq(paymentContracts.id, row.id), eq(paymentContracts.version, row.version), eq(paymentContracts.status, 'pending')))
        .returning();
      if (signed) row = signed;
      else row = await ensureContractByNo(row);
    } else {
      const [pending] = await db.update(paymentContracts).set({
        channelContractNo: res.channelContractNo ?? null,
        version: sql`${paymentContracts.version} + 1`,
      }).where(and(eq(paymentContracts.id, row.id), eq(paymentContracts.version, row.version), eq(paymentContracts.status, 'pending'))).returning();
      if (pending) row = pending;
    }
  } catch (err) {
    const [unknown] = await db.update(paymentContracts).set({
      status: 'unknown',
      unknownOperation: 'sign',
      errorMessage: (err instanceof Error ? err.message : '渠道签约结果待确认').slice(0, 500),
      version: sql`${paymentContracts.version} + 1`,
    }).where(and(eq(paymentContracts.id, row.id), eq(paymentContracts.version, row.version), eq(paymentContracts.status, 'pending'))).returning();
    if (unknown) row = unknown;
  }

  let firstDeduct: DeductResult | null = null;
  if (input.firstDeductNow && row.status === 'signed') {
    try {
      firstDeduct = await executeDeduction(row);
      row = await ensureContractByNo(row);
    } catch (err) {
      logger.warn('[payment-contract] first deduct failed', { contractNo: row.contractNo, err: err instanceof Error ? err.message : err });
    }
  }
  return { contract: mapContract({ ...row, plan }), firstDeduct };
}

async function ensureContractByNo(scope: Pick<PaymentContractRow, 'contractNo' | 'appId' | 'currency' | 'tenantId'>): Promise<PaymentContractRow> {
  const [row] = await db.select().from(paymentContracts).where(and(
    eq(paymentContracts.contractNo, scope.contractNo),
    eq(paymentContracts.appId, scope.appId),
    eq(paymentContracts.currency, scope.currency),
    exactTenantCondition(paymentContracts.tenantId, scope.tenantId),
  )).limit(1);
  requireRow(row, '签约协议不存在');
  return row;
}

/** 管理端创建签约（演示/测试）：bizType=admin_contract，bizId=协议号自身（不与业务单冲突） */
export async function adminCreateContract(input: CreatePaymentContractInput): Promise<SignContractResult> {
  const bizId = `ADM${Date.now()}${randomInt(100, 999)}`;
  return signContract({
    applicationId: input.applicationId,
    planId: input.planId,
    payMethod: input.payMethod,
    currency: input.currency,
    signerAccount: input.signerAccount,
    signerName: input.signerName,
    bizType: 'admin_contract',
    bizId,
    remark: input.remark,
    tenantId: requireTenantScopeId(currentUser()),
    firstDeductNow: input.firstDeductNow,
  });
}

/** 解约（渠道解约成功后本地终态；pending/signed/paused 均可解约） */
export async function terminateContract(row: PaymentContractRow): Promise<PaymentContract> {
  if (row.status === 'terminated') throw new HTTPException(400, { message: '协议已解约' });
  if (row.status !== 'signed' && row.status !== 'paused') throw new HTTPException(400, { message: '只有已签约或已暂停协议可解约' });
  const contractConfig = await loadContractConfig(row);
  const method = row.channel === 'wechat' ? ('wechat_papay' as const) : ('alipay_cycle' as const);
  await assertContractOperation(contractConfig, 'contract.terminate', method, row.currency);
  const adapter = getAdapter(row.channel);
  if (!adapter.terminateContract) throw new HTTPException(400, { message: `CAPABILITY_UNSUPPORTED: ${row.channel}/contract.terminate` });
  const [maybeClaimed] = await db.update(paymentContracts).set({
    status: 'unknown', unknownOperation: 'terminate', errorMessage: null, version: sql`${paymentContracts.version} + 1`,
  }).where(and(
    eq(paymentContracts.id, row.id), eq(paymentContracts.version, row.version), inArray(paymentContracts.status, ['signed', 'paused']),
  )).returning();
  const claimed = requireRow(maybeClaimed, '协议状态已变化，请刷新后重试', 409);
  try {
    await adapter.terminateContract(buildAdapterContext(contractConfig), {
      outContractNo: row.contractNo,
      channelContractNo: row.channelContractNo ?? undefined,
    });
    const [updated] = await db.update(paymentContracts).set({
      status: 'terminated', unknownOperation: null, terminatedAt: new Date(), nextDeductAt: null,
      errorMessage: null, version: sql`${paymentContracts.version} + 1`,
    }).where(and(eq(paymentContracts.id, claimed.id), eq(paymentContracts.version, claimed.version), eq(paymentContracts.status, 'unknown'), eq(paymentContracts.unknownOperation, 'terminate'))).returning();
    return mapContract(updated ?? claimed);
  } catch (err) {
    const [unknown] = await db.update(paymentContracts).set({
      errorMessage: (err instanceof Error ? err.message : '渠道解约结果待确认').slice(0, 500),
      version: sql`${paymentContracts.version} + 1`,
    }).where(and(eq(paymentContracts.id, claimed.id), eq(paymentContracts.version, claimed.version), eq(paymentContracts.status, 'unknown'))).returning();
    return mapContract(unknown ?? claimed);
  }
}

export async function pauseContract(id: number, applicationId: number): Promise<PaymentContract> {
  requireTenantScopeId(currentUser());
  const row = await ensureContract(id, applicationId);
  if (row.status !== 'signed') throw new HTTPException(400, { message: '仅已签约协议可暂停' });
  const [maybeUpdated] = await db.update(paymentContracts).set({ status: 'paused', version: sql`${paymentContracts.version} + 1` }).where(and(eq(paymentContracts.id, id), eq(paymentContracts.version, row.version), eq(paymentContracts.status, 'signed'))).returning();
  const updated = requireRow(maybeUpdated, '协议状态已变化，请刷新后重试', 400);
  return mapContract(updated);
}

export async function resumeContract(id: number, applicationId: number): Promise<PaymentContract> {
  requireTenantScopeId(currentUser());
  const row = await ensureContract(id, applicationId);
  if (row.status !== 'paused') throw new HTTPException(400, { message: '仅已暂停协议可恢复' });
  const [maybeUpdated] = await db
    .update(paymentContracts)
    .set({ status: 'signed', failCount: 0, nextDeductAt: new Date(), version: sql`${paymentContracts.version} + 1` })
    .where(and(eq(paymentContracts.id, id), eq(paymentContracts.version, row.version), eq(paymentContracts.status, 'paused')))
    .returning();
  const updated = requireRow(maybeUpdated, '协议状态已变化，请刷新后重试', 400);
  return mapContract(updated);
}

export async function recoverContract(id: number, applicationId: number): Promise<PaymentContract> {
  requireTenantScopeId(currentUser());
  const row = await ensureContract(id, applicationId);
  if (row.status !== 'pending' && row.status !== 'unknown') return getContract(id, applicationId);
  const operation = row.unknownOperation ?? 'sign';
  const config = await loadContractConfig(row);
  const method = row.channel === 'wechat' ? ('wechat_papay' as const) : ('alipay_cycle' as const);
  try {
    await assertContractOperation(config, 'contract.query', method, row.currency, true);
  } catch (err) {
    const [unchanged] = await db.update(paymentContracts).set({
      errorMessage: (err instanceof Error ? err.message : '渠道未提供协议查询能力').slice(0, 500),
      version: sql`${paymentContracts.version} + 1`,
    }).where(and(eq(paymentContracts.id, row.id), eq(paymentContracts.version, row.version), inArray(paymentContracts.status, ['pending', 'unknown']))).returning();
    return mapContract(unchanged ?? row);
  }
  const adapter = getAdapter(row.channel);
  if (!adapter.queryContract) {
    const [unchanged] = await db.update(paymentContracts).set({ errorMessage: 'CAPABILITY_UNSUPPORTED: 渠道未实现协议查单', version: sql`${paymentContracts.version} + 1` })
      .where(and(eq(paymentContracts.id, row.id), eq(paymentContracts.version, row.version))).returning();
    return mapContract(unchanged ?? row);
  }
  let result;
  try {
    result = await adapter.queryContract(buildAdapterContext(config), {
      outContractNo: row.contractNo,
      channelContractNo: row.channelContractNo ?? undefined,
      operation,
    });
  } catch (err) {
    const [unchanged] = await db.update(paymentContracts).set({ errorMessage: (err instanceof Error ? err.message : '协议查单失败').slice(0, 500), version: sql`${paymentContracts.version} + 1` })
      .where(and(eq(paymentContracts.id, row.id), eq(paymentContracts.version, row.version))).returning();
    return mapContract(unchanged ?? row);
  }
  if (result.status === 'pending') return mapContract(row);
  if (result.status === 'signed' && operation === 'sign') {
    const plan = requireRow(await db.query.paymentDeductPlans.findFirst({ where: and(
      eq(paymentDeductPlans.id, row.planId),
      exactTenantCondition(paymentDeductPlans.tenantId, row.tenantId),
    ) }), '扣款计划不存在');
    const [signed] = await db.update(paymentContracts).set({
      status: 'signed', unknownOperation: null, channelContractNo: result.channelContractNo ?? row.channelContractNo,
      signedAt: new Date(), nextDeductAt: plan ? advancePeriod(new Date(), plan) : null,
      errorMessage: null, version: sql`${paymentContracts.version} + 1`,
    }).where(and(eq(paymentContracts.id, row.id), eq(paymentContracts.version, row.version), inArray(paymentContracts.status, ['pending', 'unknown']))).returning();
    return mapContract(signed ?? row);
  }
  if (result.status === 'terminated' && operation === 'terminate') {
    const [terminated] = await db.update(paymentContracts).set({
      status: 'terminated', unknownOperation: null, terminatedAt: new Date(), nextDeductAt: null,
      errorMessage: null, version: sql`${paymentContracts.version} + 1`,
    }).where(and(eq(paymentContracts.id, row.id), eq(paymentContracts.version, row.version), eq(paymentContracts.status, 'unknown'))).returning();
    return mapContract(terminated ?? row);
  }
  if (result.status === 'failed') {
    const [failed] = await db.update(paymentContracts).set({
      status: 'failed', unknownOperation: null, errorMessage: result.failReason?.slice(0, 500) ?? '渠道确认协议操作失败',
      nextDeductAt: null, version: sql`${paymentContracts.version} + 1`,
    }).where(and(eq(paymentContracts.id, row.id), eq(paymentContracts.version, row.version), inArray(paymentContracts.status, ['pending', 'unknown']))).returning();
    return mapContract(failed ?? row);
  }
  const [unchanged] = await db.update(paymentContracts).set({ errorMessage: `渠道返回状态 ${result.status} 与待恢复操作 ${operation} 不一致`, version: sql`${paymentContracts.version} + 1` })
    .where(and(eq(paymentContracts.id, row.id), eq(paymentContracts.version, row.version))).returning();
  return mapContract(unchanged ?? row);
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
      version: sql`${paymentContracts.version} + 1`,
      ...(paused ? { status: 'paused' as const, nextDeductAt: null } : { nextDeductAt: dayjs().add(1, 'day').toDate() }),
    })
    .where(and(eq(paymentContracts.id, row.id), eq(paymentContracts.version, row.version), eq(paymentContracts.status, 'signed')));
  logger.warn('[payment-contract] deduct failed', { contractNo: row.contractNo, failCount, paused, reason });
}

/** 扣款失败订单落终态 + 可靠发 payment.failed 事件（与 createPayment 失败分支同模式） */
async function markDeductOrderFailed(order: PaymentOrderRow, reason: string): Promise<void> {
  const eventId = await db.transaction(async (tx) => {
    const [failed] = await tx.update(paymentOrders).set({ status: 'failed', errorMessage: reason.slice(0, 500), version: sql`${paymentOrders.version} + 1` })
      .where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.version, order.version), inArray(paymentOrders.status, ['pending', 'paying', 'unknown']))).returning();
    if (!failed) return null;
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
        channelConfigId: order.channelConfigId,
        appId: order.appId,
        currency: order.currency,
        amount: order.amount,
        userId: order.userId,
        tenantId: order.tenantId,
      },
    });
  });
  if (eventId != null) setImmediate(() => { void processEvent(eventId).catch((err) => logger.error('[payment-contract] process failure event failed', { eventId, err })); });
}

/**
 * 执行一期扣款（cron 到期扫描 / 管理端补扣 / 签约首扣共用）。
 * 并发安全：payment_orders 活跃业务单唯一索引兜底，同协议并发扣款仅一笔能落单。
 */
export async function executeDeduction(input: PaymentContractRow): Promise<DeductResult> {
  const row = await ensureContractByNo(input);
  if (row.status !== 'signed') throw new HTTPException(400, { message: '仅已签约协议可执行扣款' });
  if (!row.channelContractNo) throw new HTTPException(400, { message: '协议缺少渠道协议号，无法扣款' });
  const plan = requireRow(await db.query.paymentDeductPlans.findFirst({ where: and(
    eq(paymentDeductPlans.id, row.planId),
    exactTenantCondition(paymentDeductPlans.tenantId, row.tenantId),
  ) }), '扣款计划不存在');

  const contractConfig = await loadContractConfig(row);
  const applicationRoute = await resolveApplicationChannelConfig(row.appId, row.channel, row.tenantId ?? null);
  if (applicationRoute.channelConfigId !== contractConfig.id) throw new HTTPException(409, { message: '签约协议商户配置与支付应用路由不一致' });
  const payMethod = row.channel === 'wechat' ? ('wechat_papay' as const) : ('alipay_cycle' as const);
  await assertContractOperation(contractConfig, 'contract.deduct', payMethod, row.currency);
  const adapter = getAdapter(row.channel);
  if (!adapter.deductContract) throw new HTTPException(400, { message: `CAPABILITY_UNSUPPORTED: ${row.channel}/contract.deduct` });

  let order: PaymentOrderRow;
  let claimedContract: PaymentContractRow;
  let shouldCallProvider: boolean;
  try {
    ({ order, contract: claimedContract, shouldCallProvider } = await db.transaction(async (tx) => {
      // Lock and re-read the contract so the period sequence is allocated from
      // the latest committed success count, even when cron and a manual retry
      // race each other.
      const [lockedContract] = await tx
        .select()
        .from(paymentContracts)
        .where(and(
          eq(paymentContracts.id, row.id),
          eq(paymentContracts.appId, row.appId),
          eq(paymentContracts.currency, row.currency),
          exactTenantCondition(paymentContracts.tenantId, row.tenantId),
        ))
        .for('update')
        .limit(1);
      if (!lockedContract || lockedContract.status !== 'signed' || !lockedContract.channelContractNo) {
        throw new HTTPException(409, { message: '协议状态已变化，请刷新后重试' });
      }
      const sequence = lockedContract.totalDeductCount + 1;
      const stableOrderNo = genDeductOrderNo(lockedContract.id, sequence);
      const orderTenant = exactTenantCondition(paymentOrders.tenantId, lockedContract.tenantId);
      let [existingOrder] = await tx
        .select()
        .from(paymentOrders)
        .where(and(
          eq(paymentOrders.orderNo, stableOrderNo),
          eq(paymentOrders.appId, lockedContract.appId),
          orderTenant,
        ))
        .for('update')
        .limit(1);
      if (existingOrder) {
        const sameScope = existingOrder.bizType === lockedContract.bizType
          && existingOrder.bizId === lockedContract.bizId
          && existingOrder.amount === plan.amount
          && existingOrder.currency === lockedContract.currency
          && existingOrder.channel === lockedContract.channel
          && existingOrder.channelConfigId === contractConfig.id
          && existingOrder.payMethod === payMethod;
        if (!sameScope) throw new HTTPException(409, { message: '扣款幂等订单作用域不一致，请联系管理员' });

        // A definitively failed local attempt may be retried with the same
        // provider idempotency key. Pending/paying/unknown orders are never
        // sent again: query/recovery must decide their outcome first.
        if (existingOrder.status === 'failed') {
          const [retryOrder] = await tx.update(paymentOrders).set({
            status: 'pending',
            channelTradeNo: null,
            paidAmount: null,
            feeAmount: null,
            netAmount: null,
            paidAt: null,
            errorMessage: null,
            version: sql`${paymentOrders.version} + 1`,
          }).where(and(eq(paymentOrders.id, existingOrder.id), eq(paymentOrders.status, 'failed'))).returning();
          existingOrder = retryOrder ?? existingOrder;
          const [maybeContract] = await tx.update(paymentContracts).set({ lastOrderNo: stableOrderNo, version: sql`${paymentContracts.version} + 1` })
            .where(and(eq(paymentContracts.id, lockedContract.id), eq(paymentContracts.version, lockedContract.version), eq(paymentContracts.status, 'signed'))).returning();
          const contract = requireRow(maybeContract, '协议状态已变化，请刷新后重试', 409);
          return { order: existingOrder, contract, shouldCallProvider: true };
        }
        return { order: existingOrder, contract: lockedContract, shouldCallProvider: false };
      }

      const [createdOrder] = await tx.insert(paymentOrders).values({
        orderNo: stableOrderNo,
        outTradeNo: stableOrderNo,
        bizType: lockedContract.bizType,
        bizId: lockedContract.bizId,
        subject: `${plan.name}（第 ${sequence} 期代扣）`,
        body: `签约协议 ${lockedContract.contractNo}`,
        amount: plan.amount,
        currency: lockedContract.currency,
        channel: lockedContract.channel,
        channelConfigId: contractConfig.id,
        appId: lockedContract.appId,
        payMethod,
        status: 'pending',
        expiredAt: dayjs().add(30, 'minute').toDate(),
        tenantId: lockedContract.tenantId,
      }).returning();
      const [maybeContract] = await tx.update(paymentContracts).set({ lastOrderNo: stableOrderNo, version: sql`${paymentContracts.version} + 1` })
        .where(and(eq(paymentContracts.id, lockedContract.id), eq(paymentContracts.version, lockedContract.version), eq(paymentContracts.status, 'signed'))).returning();
      const contract = requireRow(maybeContract, '协议状态已变化，请刷新后重试', 409);
      return { order: createdOrder, contract, shouldCallProvider: true };
    }));
  } catch (err) {
    if (isPgUniqueViolation(err)) throw new HTTPException(400, { message: '该协议存在处理中的扣款订单，请稍后重试' });
    throw err;
  }

  if (!shouldCallProvider) {
    let resolved = order;
    if (['pending', 'paying', 'unknown'].includes(order.status)) {
      try {
        resolved = await syncOrderStatus(order);
      } catch (err) {
        logger.warn('[payment-contract] existing deduction query failed', { orderNo: order.orderNo, err });
      }
    }
    if (['success', 'refunding', 'refunded'].includes(resolved.status)) {
      try {
        await advanceContractOnPaid({ orderNo: resolved.orderNo, bizType: claimedContract.bizType, bizId: claimedContract.bizId });
      } catch (err) {
        // The durable payment event subscriber will retry contract advancement;
        // never turn an already-paid order into an unknown outcome.
        logger.error('[payment-contract] existing success advancement failed', { orderNo: resolved.orderNo, err });
      }
      return { orderNo: resolved.orderNo, deductStatus: 'success' };
    }
    if (resolved.status === 'failed' || resolved.status === 'closed') {
      return { orderNo: resolved.orderNo, deductStatus: 'failed', failReason: resolved.errorMessage ?? '扣款订单已失败' };
    }
    return { orderNo: resolved.orderNo, deductStatus: 'processing', failReason: '已有扣款订单正在处理，等待渠道查单收敛' };
  }

  const orderNo = order.orderNo;
  try {
    const res = await adapter.deductContract(buildAdapterContext(contractConfig), {
      channelContractNo: claimedContract.channelContractNo!,
      outTradeNo: orderNo,
      amount: plan.amount,
      subject: `${plan.name} 周期扣款`,
    });
    if (res.status === 'success') {
      await markOrderPaid(order, { channelTradeNo: res.channelTradeNo, paidAmount: plan.amount, paidAt: new Date() });
      // The outbox subscriber is intentionally asynchronous for crash
      // resilience. Advance the contract in this request as well so a
      // successful first deduction is reflected in the returned DTO; the
      // subscriber remains idempotent and safely replays the same transition.
      try {
        await advanceContractOnPaid({ orderNo, bizType: claimedContract.bizType, bizId: claimedContract.bizId });
      } catch (err) {
        // markOrderPaid already committed the authoritative payment state.
        // Let the durable payment event subscriber retry the schedule update.
        logger.error('[payment-contract] paid deduction advancement failed', { orderNo, err });
      }
      return { orderNo, deductStatus: 'success' };
    }
    if (res.status === 'processing') {
      // 渠道受理中：置 paying，由 paymentReconciliation cron 查单收敛，成功事件推进排期
      await db.update(paymentOrders).set({ status: 'paying', channelTradeNo: res.channelTradeNo ?? null, version: sql`${paymentOrders.version} + 1` })
        .where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.version, order.version), eq(paymentOrders.status, 'pending')));
      return { orderNo, deductStatus: 'processing' };
    }
    const reason = res.failReason ?? '渠道扣款失败';
    await markDeductOrderFailed(order, reason);
    await recordDeductFailure(claimedContract, plan, reason);
    return { orderNo, deductStatus: 'failed', failReason: reason };
  } catch (err) {
    const reason = (err instanceof Error ? err.message : '渠道扣款请求失败').slice(0, 500);
    await db.update(paymentOrders).set({ status: 'unknown', errorMessage: reason, version: sql`${paymentOrders.version} + 1` })
      .where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.version, order.version), inArray(paymentOrders.status, ['pending', 'paying'])));
    return { orderNo, deductStatus: 'processing', failReason: `渠道结果待确认：${reason}` };
  }
}

/** 管理端按协议 id 手动补扣 */
export async function deductContractById(id: number, applicationId: number): Promise<DeductResult & { contract: PaymentContract }> {
  requireTenantScopeId(currentUser());
  const row = await ensureContract(id, applicationId);
  const result = await executeDeduction(row);
  return { ...result, contract: await getContract(id, applicationId) };
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
  const [order] = await db
    .select()
    .from(paymentOrders)
    .where(eq(paymentOrders.orderNo, event.orderNo))
    .limit(1);
  // A success event may be replayed after the order has entered refunding or
  // refunded. The paid timestamp remains the authoritative deduction fact;
  // accepting those terminal follow-up states lets recovery finish the
  // contract schedule without issuing another charge.
  const paidAt = order?.paidAt;
  if (!order || !['success', 'refunding', 'refunded'].includes(order.status) || !paidAt) return;
  // 仅代扣单推进排期（同业务的普通支付单，如手动购买，不影响协议周期）
  if (order.payMethod !== 'wechat_papay' && order.payMethod !== 'alipay_cycle') return;
  if (order.bizType !== event.bizType || order.bizId !== event.bizId) return;
  const paidAmount = order.paidAmount ?? order.amount;
  await db.transaction(async (tx) => {
    // A row lock serializes different successful periods for the same
    // contract. The idempotency guard below then makes outbox replays no-ops.
    const [row] = await tx.select().from(paymentContracts).where(and(
      eq(paymentContracts.bizType, event.bizType),
      eq(paymentContracts.bizId, event.bizId),
      eq(paymentContracts.appId, order.appId),
      eq(paymentContracts.currency, order.currency),
      eq(paymentContracts.lastOrderNo, event.orderNo),
      exactTenantCondition(paymentContracts.tenantId, order.tenantId),
      inArray(paymentContracts.status, ['signed', 'paused', 'terminated']),
    )).for('update').limit(1);
    if (!row) return;
    const plan = await tx.query.paymentDeductPlans.findFirst({ where: and(
      eq(paymentDeductPlans.id, row.planId),
      exactTenantCondition(paymentDeductPlans.tenantId, row.tenantId),
    ) });
    if (!plan || plan.amount !== paidAmount) return;
    if (row.lastDeductAt && row.lastDeductAt >= paidAt) return;
    const next = row.status === 'signed' ? advancePeriod(paidAt, plan) : null;
    await tx.update(paymentContracts).set({
      nextDeductAt: next,
      lastDeductAt: paidAt,
      failCount: 0,
      totalDeductCount: sql`${paymentContracts.totalDeductCount} + 1`,
      version: sql`${paymentContracts.version} + 1`,
    }).where(and(
      eq(paymentContracts.id, row.id),
      eq(paymentContracts.version, row.version),
      inArray(paymentContracts.status, ['signed', 'paused', 'terminated']),
      or(isNull(paymentContracts.lastDeductAt), lt(paymentContracts.lastDeductAt, paidAt)),
    ));
  });
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
