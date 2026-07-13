/**
 * 商户资金账户 Service（渠道×租户余额快照）。
 *
 * 账户余额不独立记账，而是随资金台账流水（recordLedgerEntry）原子联动，
 * 映射规则：payment→待结算+，fee/refund→待结算-，settlement→待结算转可用，
 * transfer→可用-，adjust→可用±。快照与流水聚合口径一致，checkAccounts() 可随时核对，
 * rebuildAccountsFromLedger() 支持从全量流水重建快照（存量数据迁移/差错修复）。
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { paymentAccounts, paymentLedgerEntries, paymentPreauths, type PaymentAccountRow } from '../../db/schema';
import { currentUser, currentUserOrNull } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { mergeWhere } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import type { PaymentAccount, PaymentAccountCheckRow, PaymentChannel, PaymentLedgerDirection, PaymentLedgerType } from '@zenith/shared';

export function mapAccount(row: PaymentAccountRow): PaymentAccount {
  return {
    id: row.id,
    channel: row.channel,
    pendingSettle: row.pendingSettle,
    available: row.available,
    frozen: row.frozen,
    version: row.version,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function accountWhere(channel: PaymentChannel, tenantId: number | null) {
  return tenantId == null
    ? and(eq(paymentAccounts.channel, channel), isNull(paymentAccounts.tenantId))
    : and(eq(paymentAccounts.channel, channel), eq(paymentAccounts.tenantId, tenantId));
}

/** 查找或创建账户（并发安全：INSERT ON CONFLICT DO NOTHING 后回读） */
export async function ensureAccount(channel: PaymentChannel, tenantId: number | null): Promise<PaymentAccountRow> {
  const [existing] = await db.select().from(paymentAccounts).where(accountWhere(channel, tenantId)).limit(1);
  if (existing) return existing;
  await db.insert(paymentAccounts).values({ channel, tenantId }).onConflictDoNothing();
  const [row] = await db.select().from(paymentAccounts).where(accountWhere(channel, tenantId)).limit(1);
  return row;
}

interface BalanceDelta {
  pendingSettle?: number;
  available?: number;
}

/** 流水类型 → 账户余额变化映射（与 checkAccounts 的聚合口径必须保持一致） */
function deltaOf(type: PaymentLedgerType, direction: PaymentLedgerDirection, amount: number): BalanceDelta | null {
  switch (type) {
    case 'payment':
      return { pendingSettle: amount };
    case 'fee':
      return { pendingSettle: -amount };
    case 'refund':
      return { pendingSettle: -amount };
    case 'settlement':
      // 结算划转：待结算 → 可用
      return { pendingSettle: -amount, available: amount };
    case 'transfer':
      return { available: -amount };
    case 'adjust':
      return { available: direction === 'in' ? amount : -amount };
    default:
      return null;
  }
}

/**
 * 台账流水联动账户余额（由 recordLedgerEntry 在流水真实落库后调用）。
 * 原子自增更新，失败仅告警不阻断记账（快照可由 rebuild 修复，流水是权威数据源）。
 */
export async function applyLedgerToAccount(input: {
  type: PaymentLedgerType;
  direction: PaymentLedgerDirection;
  amount: number;
  channel?: PaymentChannel | null;
  tenantId?: number | null;
}): Promise<void> {
  if (!input.channel) return;
  const delta = deltaOf(input.type, input.direction, input.amount);
  if (!delta) return;
  try {
    const account = await ensureAccount(input.channel, input.tenantId ?? null);
    await db
      .update(paymentAccounts)
      .set({
        pendingSettle: sql`${paymentAccounts.pendingSettle} + ${delta.pendingSettle ?? 0}`,
        available: sql`${paymentAccounts.available} + ${delta.available ?? 0}`,
        version: sql`${paymentAccounts.version} + 1`,
      })
      .where(eq(paymentAccounts.id, account.id));
  } catch (err) {
    logger.error('[payment-account] apply ledger delta failed', { channel: input.channel, type: input.type, err: err instanceof Error ? err.message : err });
  }
}

/** 账户总览（按当前用户租户过滤） */
export async function listAccounts(): Promise<PaymentAccount[]> {
  const user = currentUserOrNull();
  const where = user ? tenantCondition(paymentAccounts, user) : undefined;
  const rows = await db.select().from(paymentAccounts).where(mergeWhere(undefined, where)).orderBy(paymentAccounts.channel);
  return rows.map(mapAccount);
}

// ─── 余额核对（流水聚合 vs 快照）──────────────────────────────────────────────

interface ComputedBalance {
  pendingSettle: number;
  available: number;
}

/** 按流水聚合重算某账户维度的理论余额（口径与 deltaOf 一致） */
async function computeFromLedger(channel: PaymentChannel, tenantId: number | null): Promise<ComputedBalance> {
  const cond = tenantId == null
    ? and(eq(paymentLedgerEntries.channel, channel), isNull(paymentLedgerEntries.tenantId))
    : and(eq(paymentLedgerEntries.channel, channel), eq(paymentLedgerEntries.tenantId, tenantId));
  const [agg] = await db
    .select({
      payment: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.type} = 'payment' then ${paymentLedgerEntries.amount} else 0 end),0)`,
      fee: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.type} = 'fee' then ${paymentLedgerEntries.amount} else 0 end),0)`,
      refund: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.type} = 'refund' then ${paymentLedgerEntries.amount} else 0 end),0)`,
      settlement: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.type} = 'settlement' then ${paymentLedgerEntries.amount} else 0 end),0)`,
      transfer: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.type} = 'transfer' then ${paymentLedgerEntries.amount} else 0 end),0)`,
      adjustIn: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.type} = 'adjust' and ${paymentLedgerEntries.direction} = 'in' then ${paymentLedgerEntries.amount} else 0 end),0)`,
      adjustOut: sql<number>`coalesce(sum(case when ${paymentLedgerEntries.type} = 'adjust' and ${paymentLedgerEntries.direction} = 'out' then ${paymentLedgerEntries.amount} else 0 end),0)`,
    })
    .from(paymentLedgerEntries)
    .where(cond);
  const n = (v: unknown) => Number(v ?? 0);
  return {
    pendingSettle: n(agg?.payment) - n(agg?.fee) - n(agg?.refund) - n(agg?.settlement),
    available: n(agg?.settlement) - n(agg?.transfer) + n(agg?.adjustIn) - n(agg?.adjustOut),
  };
}

/** 收集流水与快照中出现过的全部 (channel, tenantId) 维度 */
async function collectDimensions(): Promise<Array<{ channel: PaymentChannel; tenantId: number | null }>> {
  const [fromLedger, fromAccounts] = await Promise.all([
    db
      .selectDistinct({ channel: paymentLedgerEntries.channel, tenantId: paymentLedgerEntries.tenantId })
      .from(paymentLedgerEntries)
      .where(sql`${paymentLedgerEntries.channel} is not null`),
    db.selectDistinct({ channel: paymentAccounts.channel, tenantId: paymentAccounts.tenantId }).from(paymentAccounts),
  ]);
  const seen = new Set<string>();
  const dims: Array<{ channel: PaymentChannel; tenantId: number | null }> = [];
  for (const d of [...fromLedger, ...fromAccounts]) {
    if (!d.channel) continue;
    const key = `${d.channel}:${d.tenantId ?? 'null'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dims.push({ channel: d.channel as PaymentChannel, tenantId: d.tenantId ?? null });
  }
  return dims;
}

/** 进行中预授权冻结金额聚合（账户 frozen 快照核对口径） */
async function computeFrozenFromPreauths(channel: PaymentChannel, tenantId: number | null): Promise<number> {
  const cond = tenantId == null
    ? and(eq(paymentPreauths.channel, channel), isNull(paymentPreauths.tenantId))
    : and(eq(paymentPreauths.channel, channel), eq(paymentPreauths.tenantId, tenantId));
  const [agg] = await db
    .select({ total: sql<number>`coalesce(sum(${paymentPreauths.frozenAmount}),0)` })
    .from(paymentPreauths)
    .where(and(cond, eq(paymentPreauths.status, 'frozen')));
  return Number(agg?.total ?? 0);
}

/** 余额核对：逐账户比对快照与流水聚合，返回差异明细（match=false 为异常账户） */
export async function checkAccounts(): Promise<PaymentAccountCheckRow[]> {
  const dims = await collectDimensions();
  const result: PaymentAccountCheckRow[] = [];
  for (const dim of dims) {
    const [snapshot] = await db.select().from(paymentAccounts).where(accountWhere(dim.channel, dim.tenantId)).limit(1);
    const computed = await computeFromLedger(dim.channel, dim.tenantId);
    const frozenComputed = await computeFrozenFromPreauths(dim.channel, dim.tenantId);
    const snapPending = snapshot?.pendingSettle ?? 0;
    const snapAvailable = snapshot?.available ?? 0;
    const snapFrozen = snapshot?.frozen ?? 0;
    result.push({
      channel: dim.channel,
      pendingSettleSnapshot: snapPending,
      pendingSettleComputed: computed.pendingSettle,
      availableSnapshot: snapAvailable,
      availableComputed: computed.available,
      frozenSnapshot: snapFrozen,
      frozenComputed,
      match: snapPending === computed.pendingSettle && snapAvailable === computed.available && snapFrozen === frozenComputed,
    });
  }
  return result;
}

/** 从全量流水重建账户快照（存量数据初始化 / 差错修复；流水为权威数据源） */
export async function rebuildAccountsFromLedger(): Promise<number> {
  const dims = await collectDimensions();
  for (const dim of dims) {
    const computed = await computeFromLedger(dim.channel, dim.tenantId);
    const frozenComputed = await computeFrozenFromPreauths(dim.channel, dim.tenantId);
    const account = await ensureAccount(dim.channel, dim.tenantId);
    await db
      .update(paymentAccounts)
      .set({
        pendingSettle: computed.pendingSettle,
        available: computed.available,
        frozen: frozenComputed,
        version: sql`${paymentAccounts.version} + 1`,
      })
      .where(eq(paymentAccounts.id, account.id));
  }
  logger.info('[payment-account] rebuilt from ledger', { accounts: dims.length });
  return dims.length;
}

/** 人工调账：走台账 adjust 流水（自动联动可用余额），保证流水与快照口径一致 */
export async function adjustAccount(input: { channel: PaymentChannel; direction: PaymentLedgerDirection; amount: number; remark?: string }): Promise<PaymentAccount> {
  if (input.amount <= 0) throw new HTTPException(400, { message: '调账金额必须大于 0' });
  const user = currentUser();
  const tenantId = user.tenantId ?? null;
  // 延迟导入避免与 ledger service 循环依赖
  const { recordLedgerEntry } = await import('./payment-ledger.service');
  await recordLedgerEntry({
    direction: input.direction,
    type: 'adjust',
    amount: input.amount,
    channel: input.channel,
    tenantId,
    remark: `人工调账${input.remark ? `：${input.remark}` : ''}（操作人 ${user.username}）`,
  });
  const account = await ensureAccount(input.channel, tenantId);
  return mapAccount(account);
}
