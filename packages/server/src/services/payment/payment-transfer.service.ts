/**
 * 转账/代付 Service。
 * 对接渠道适配器 transfer/queryTransfer（微信商家转账到零钱、支付宝单笔转账；sandbox 渠道为模拟实现）。
 * 状态机：pending → processing → success / failed / unknown；
 * 资金安全：outTransferNo 为渠道幂等键（(channel, out_transfer_no) 唯一），
 * 高额转账先进入四眼审批，审批前严禁调用渠道；未知结果只允许查单收敛，杜绝双付；
 * 转账成功写入不可变会计凭证，并捕获资金预占。
 */
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { db } from '../../db';
import {
  paymentChannelConfigs,
  paymentFundReservations,
  paymentJournalLines,
  paymentTransfers,
  type PaymentChannelConfigRow,
  type PaymentTransferRow,
} from '../../db/schema';
import { currentUser } from '../../lib/context';
import { requireTenantScopeId, tenantCondition } from '../../lib/tenant';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { buildAdapterContext } from './payment.service';
import { ensureSystemLedgerAccount, postSystemJournal } from './payment-journal.service';
import { getAdapter } from '../../lib/payment/registry';
import logger from '../../lib/logger';
import { isIndeterminateProviderError } from '../../lib/payment/provider-http';
import type {
  ApprovePaymentTransferInput,
  CreatePaymentTransferInput,
  PaymentChannel,
  PaymentTransfer,
  PaymentTransferApprovalStatus,
  PaymentTransferStatus,
} from '@zenith/shared/payment';
import { assertPaymentEngineConfig, resolvePaymentChannelConfig } from './payment-channel-config-resolver';
import { resolveApplicationChannelConfig } from './payment-apps.service';
import { isPgUniqueViolation } from '../../lib/db-errors';
import { assertEffectivePaymentOperation } from './payment-capability-evaluator';
import { getSettings } from '../../lib/settings';

function genNo(): string {
  return `TRF${Date.now()}${randomInt(1000, 9999)}`;
}

async function transferApprovalThreshold(tenantId: number | null): Promise<number> {
  return Math.max(0, Math.trunc((await getSettings('payment', { tenantId })).transferApprovalThreshold));
}

export function mapTransfer(row: PaymentTransferRow & { operatorName?: string | null }): PaymentTransfer {
  return {
    id: row.id,
    transferNo: row.transferNo,
    outTransferNo: row.outTransferNo,
    channel: row.channel,
    appId: row.appId,
    channelConfigId: row.channelConfigId,
    currency: row.currency,
    receiverAccount: row.receiverAccount,
    receiverName: row.receiverName ?? null,
    amount: row.amount,
    remark: row.remark ?? null,
    status: row.status,
    approvalStatus: row.approvalStatus,
    appliedById: row.appliedById ?? null,
    approverId: row.approverId ?? null,
    approvedAt: formatNullableDateTime(row.approvedAt),
    approvalRemark: row.approvalRemark ?? null,
    channelTransferNo: row.channelTransferNo ?? null,
    failReason: row.failReason ?? null,
    attempts: row.attempts,
    fundReservationId: row.fundReservationId,
    version: row.version,
    bizType: row.bizType ?? null,
    bizId: row.bizId ?? null,
    finishedAt: formatNullableDateTime(row.finishedAt),
    operatorName: row.operatorName ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
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

async function recordTransferJournal(row: PaymentTransferRow, config: PaymentChannelConfigRow): Promise<void> {
  const amount = row.amount.toString();
  await postSystemJournal({
    tenantId: row.tenantId ?? null,
    operatorId: row.operatorId ?? null,
    sourceType: 'payment.transfer',
    sourceId: row.transferNo,
    description: `转账出款 ${row.transferNo}`,
    appId: row.appId,
    channelConfigId: config.id,
    currency: row.currency,
    lines: [
      { accountCode: 'merchant_available', debitAmount: amount, memo: '扣减商户可用余额' },
      { accountCode: 'provider_clearing', creditAmount: amount, memo: '渠道出款清算' },
    ],
  });
}

async function reserveTransferFunds(input: {
  tenantId: number | null;
  appId: number;
  channelConfigId: number;
  currency: string;
  transferNo: string;
  amount: number;
  reason: string;
  transferValues: Omit<typeof paymentTransfers.$inferInsert, 'fundReservationId'>;
}): Promise<PaymentTransferRow> {
  const account = await ensureSystemLedgerAccount({
    tenantId: input.tenantId,
    appId: input.appId,
    channelConfigId: input.channelConfigId,
    currency: input.currency,
  }, 'merchant_available');
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM payment_ledger_accounts WHERE id = ${account.id} FOR UPDATE`);
    const [balance] = await tx
      .select({ amount: sql<string>`coalesce(sum(${paymentJournalLines.creditAmount} - ${paymentJournalLines.debitAmount}), 0)::text` })
      .from(paymentJournalLines)
      .where(eq(paymentJournalLines.accountId, account.id));
    const [reserved] = await tx
      .select({ amount: sql<string>`coalesce(sum(${paymentFundReservations.amount}), 0)::text` })
      .from(paymentFundReservations)
      .where(and(
        eq(paymentFundReservations.accountId, account.id),
        eq(paymentFundReservations.status, 'active'),
        or(isNull(paymentFundReservations.expiresAt), gt(paymentFundReservations.expiresAt, new Date())),
      ));
    const available = BigInt(balance?.amount ?? '0') - BigInt(reserved?.amount ?? '0');
    if (available < BigInt(input.amount)) {
      throw new HTTPException(400, { message: `可用余额不足（可用 ${available.toString()} 分）` });
    }
    const [reservation] = await tx.insert(paymentFundReservations).values({
      reservationNo: `RSV${randomUUID().replaceAll('-', '')}`,
      accountId: account.id,
      sourceType: 'payment.transfer',
      sourceId: input.transferNo,
      amount: BigInt(input.amount),
      status: 'active',
      reason: input.reason,
      appId: input.appId,
      channelConfigId: input.channelConfigId,
      currency: input.currency,
      tenantId: input.tenantId,
    }).returning();
    const [transfer] = await tx.insert(paymentTransfers).values({
      ...input.transferValues,
      fundReservationId: reservation.id,
    }).returning();
    return transfer;
  });
}

async function finalizeTransferReservation(
  row: PaymentTransferRow,
  target: 'captured' | 'released',
  reason: string,
): Promise<void> {
  const [reservation] = await db
    .select({ status: paymentFundReservations.status, version: paymentFundReservations.version })
    .from(paymentFundReservations)
    .where(eq(paymentFundReservations.id, row.fundReservationId))
    .limit(1);
  if (!reservation) throw new HTTPException(409, { message: '转账资金预占不存在' });
  if (reservation.status === target) return;
  if (reservation.status !== 'active') throw new HTTPException(409, { message: `转账资金预占已处于 ${reservation.status}` });
  const [updated] = await db
    .update(paymentFundReservations)
    .set({
      status: target,
      finalizedAt: new Date(),
      finalizationReason: reason,
      version: sql`${paymentFundReservations.version} + 1`,
    })
    .where(and(
      eq(paymentFundReservations.id, row.fundReservationId),
      eq(paymentFundReservations.status, 'active'),
      eq(paymentFundReservations.version, reservation.version),
    ))
    .returning({ id: paymentFundReservations.id });
  if (!updated) throw new HTTPException(409, { message: '转账资金预占状态已变化' });
}

/** 调渠道执行转账并落状态；请求前先 claim 为 processing，未知结果只允许查单收敛。 */
async function executeTransferAtChannel(row: PaymentTransferRow, config: PaymentChannelConfigRow): Promise<PaymentTransferRow> {
  if (row.status !== 'pending') {
    throw new HTTPException(409, { message: '该转账单当前状态不可执行渠道转账' });
  }
  if (row.approvalStatus === 'pending') {
    throw new HTTPException(409, { message: '该转账单尚未完成审批' });
  }
  if (row.approvalStatus === 'rejected') {
    throw new HTTPException(409, { message: '已驳回的转账单不可执行' });
  }
  const adapter = getAdapter(row.channel);
  if (!adapter.transfer) throw new HTTPException(400, { message: `渠道 ${row.channel} 暂不支持转账` });
  const [claimed] = await db
    .update(paymentTransfers)
    .set({
      status: 'processing',
      attempts: row.attempts + 1,
      failReason: null,
      finishedAt: null,
      version: sql`${paymentTransfers.version} + 1`,
    })
    .where(and(
      eq(paymentTransfers.id, row.id),
      eq(paymentTransfers.version, row.version),
      eq(paymentTransfers.status, row.status),
      eq(paymentTransfers.attempts, row.attempts),
    ))
    .returning();
  if (!claimed) {
    return (await db.select().from(paymentTransfers).where(eq(paymentTransfers.id, row.id)).limit(1))[0] ?? row;
  }

  let res: Awaited<ReturnType<NonNullable<typeof adapter.transfer>>>;
  try {
    res = await adapter.transfer(buildAdapterContext(config), {
      outTransferNo: row.outTransferNo,
      receiverAccount: row.receiverAccount,
      receiverName: row.receiverName ?? undefined,
      amount: row.amount,
      remark: row.remark ?? undefined,
    });
  } catch (err) {
    const failReason = (err instanceof Error ? err.message : '渠道转账请求失败').slice(0, 500);
    logger.error('[payment-transfer] channel transfer failed', { transferNo: row.transferNo, err: failReason });
    const resultUnknown = isIndeterminateProviderError(err);
    if (!resultUnknown) await finalizeTransferReservation(claimed, 'released', `渠道明确失败：${failReason}`);
    const [updated] = await db
      .update(paymentTransfers)
      .set({
        status: resultUnknown ? 'unknown' : 'failed',
        failReason: resultUnknown ? `渠道结果待确认：${failReason}` : failReason,
        finishedAt: resultUnknown ? null : new Date(),
        version: sql`${paymentTransfers.version} + 1`,
      })
      .where(and(
        eq(paymentTransfers.id, claimed.id),
        eq(paymentTransfers.status, 'processing'),
        eq(paymentTransfers.attempts, claimed.attempts),
        eq(paymentTransfers.version, claimed.version),
      ))
      .returning();
    return updated ?? claimed;
  }

  if (res.status === 'success') {
    try {
      await recordTransferJournal(claimed, config);
    } catch (accountingError) {
      logger.error('[payment-transfer] journal posting failed', { transferNo: row.transferNo, err: accountingError });
      const [pending] = await db
        .update(paymentTransfers)
        .set({
          channelTransferNo: res.channelTransferNo ?? claimed.channelTransferNo,
          status: 'unknown',
          failReason: '渠道已成功，等待账务凭证落地',
          version: sql`${paymentTransfers.version} + 1`,
        })
        .where(and(eq(paymentTransfers.id, claimed.id), eq(paymentTransfers.status, 'processing'), eq(paymentTransfers.version, claimed.version)))
        .returning();
      return pending ?? claimed;
    }
    await finalizeTransferReservation(claimed, 'captured', `转账成功 ${res.channelTransferNo ?? claimed.transferNo}`);
  } else if (res.status === 'failed') {
    await finalizeTransferReservation(claimed, 'released', '渠道明确返回转账失败');
  }
  const [updated] = await db
    .update(paymentTransfers)
    .set({
      status: res.status,
      channelTransferNo: res.channelTransferNo ?? claimed.channelTransferNo,
      failReason: null,
      finishedAt: res.status === 'success' || res.status === 'failed' ? new Date() : null,
      version: sql`${paymentTransfers.version} + 1`,
    })
    .where(and(
      eq(paymentTransfers.id, claimed.id),
      eq(paymentTransfers.status, 'processing'),
      eq(paymentTransfers.attempts, claimed.attempts),
      eq(paymentTransfers.version, claimed.version),
    ))
    .returning();
  return updated ?? claimed;
}

/** 发起转账：落单（pending）→ 调渠道 → 状态落地。渠道失败不抛错，返回 failed 单据供列表重试。 */
export async function createTransfer(input: CreatePaymentTransferInput & { idempotencyKey: string; operatorId?: number }): Promise<PaymentTransfer> {
  const user = currentUser();
  const tenantId = requireTenantScopeId(user);
  const applicationRoute = await resolveApplicationChannelConfig(input.applicationId, input.channel, tenantId);
  const config = await resolvePaymentChannelConfig({
    channel: input.channel,
    channelConfigId: applicationRoute.channelConfigId,
    scope: tenantCondition(paymentChannelConfigs, user),
  });
  await assertEffectivePaymentOperation({ configRow: config, operation: 'transfer.create', currency: input.currency });
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) throw new HTTPException(400, { message: '转账请求必须提供 Idempotency-Key' });
  const requestHash = createHash('sha256').update(JSON.stringify({
    appId: applicationRoute.appId,
    channel: input.channel,
    currency: input.currency,
    receiverAccount: input.receiverAccount,
    receiverName: input.receiverName?.trim() || null,
    amount: input.amount,
    remark: input.remark?.trim() || null,
    bizType: input.bizType ?? null,
    bizId: input.bizId ?? null,
  })).digest('hex');
  const exactTenant = tenantId == null ? sql`${paymentTransfers.tenantId} is null` : eq(paymentTransfers.tenantId, tenantId);
  const [existing] = await db
    .select()
    .from(paymentTransfers)
    .where(and(
      exactTenant,
      eq(paymentTransfers.appId, applicationRoute.appId),
      eq(paymentTransfers.idempotencyKey, idempotencyKey),
    ))
    .limit(1);
  if (existing) {
    if (existing.requestHash !== requestHash) throw new HTTPException(409, { message: '同一 Idempotency-Key 不可用于不同转账请求' });
    return mapTransfer(existing);
  }
  const transferNo = genNo();
  const approvalThreshold = await transferApprovalThreshold(tenantId);
  const needApproval = approvalThreshold > 0 && input.amount >= approvalThreshold;
  let created: PaymentTransferRow;
  try {
    created = await reserveTransferFunds({
      tenantId,
      appId: applicationRoute.appId,
      channelConfigId: config.id,
      currency: input.currency,
      transferNo,
      amount: input.amount,
      reason: input.remark?.trim() || `转账 ${transferNo}`,
      transferValues: {
        transferNo,
        outTransferNo: transferNo,
        channel: input.channel,
        appId: applicationRoute.appId,
        channelConfigId: config.id,
        currency: input.currency,
        receiverAccount: input.receiverAccount,
        receiverName: input.receiverName ?? null,
        amount: input.amount,
        remark: input.remark ?? null,
        status: 'pending',
        approvalStatus: needApproval ? 'pending' : 'none',
        appliedById: input.operatorId ?? user.userId,
        idempotencyKey,
        requestHash,
        bizType: input.bizType ?? null,
        bizId: input.bizId ?? null,
        operatorId: input.operatorId ?? user.userId,
        tenantId,
      },
    });
  } catch (err) {
    if (!isPgUniqueViolation(err)) throw err;
    const [raced] = await db
      .select()
      .from(paymentTransfers)
      .where(and(exactTenant, eq(paymentTransfers.appId, applicationRoute.appId), eq(paymentTransfers.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (!raced || raced.requestHash !== requestHash) throw new HTTPException(409, { message: '转账幂等冲突' });
    return mapTransfer(raced);
  }
  if (needApproval) return mapTransfer(created);
  const updated = await executeTransferAtChannel(created, config);
  return mapTransfer(updated);
}

/**
 * 审批通过转账。
 *
 * 渠道配置与能力在状态抢占前重新校验；审批状态通过 version CAS 抢占。审批写入提交后才调用渠道，
 * 即使进程恰好中断，后台同步任务也会继续执行 approval=approved 且 status=pending 的单据。
 */
export async function approveTransfer(id: number, input: ApprovePaymentTransferInput): Promise<PaymentTransfer> {
  const user = currentUser();
  requireTenantScopeId(user);
  const row = await ensureTransfer(id);
  if (row.status !== 'pending' || row.approvalStatus !== 'pending') {
    throw new HTTPException(400, { message: '该转账单无需审批或已处理' });
  }
  if (row.appliedById != null && row.appliedById === user.userId) {
    throw new HTTPException(403, { message: '转账申请人与审批人必须为不同用户' });
  }

  const config = await resolvePaymentChannelConfig({
    channel: row.channel,
    channelConfigId: row.channelConfigId,
    scope: tenantCondition(paymentChannelConfigs, user),
  });
  await assertEffectivePaymentOperation({ configRow: config, operation: 'transfer.create', currency: row.currency });

  const [approved] = await db
    .update(paymentTransfers)
    .set({
      approvalStatus: 'approved',
      approverId: user.userId,
      approvedAt: new Date(),
      approvalRemark: input.remark.trim(),
      version: sql`${paymentTransfers.version} + 1`,
    })
    .where(and(
      eq(paymentTransfers.id, row.id),
      eq(paymentTransfers.version, row.version),
      eq(paymentTransfers.status, 'pending'),
      eq(paymentTransfers.approvalStatus, 'pending'),
    ))
    .returning();
  if (!approved) throw new HTTPException(409, { message: '转账审批状态已变化，请刷新后重试' });

  return mapTransfer(await executeTransferAtChannel(approved, config));
}

/** 驳回待审批转账，并在同一事务内释放资金预占。 */
export async function rejectTransfer(id: number, input: ApprovePaymentTransferInput): Promise<PaymentTransfer> {
  const user = currentUser();
  requireTenantScopeId(user);
  const tc = tenantCondition(paymentTransfers, user);
  const rejected = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(paymentTransfers)
      .where(and(eq(paymentTransfers.id, id), tc))
      .for('update')
      .limit(1);
    if (!row) throw new HTTPException(404, { message: '转账单不存在' });
    if (row.status !== 'pending' || row.approvalStatus !== 'pending') {
      throw new HTTPException(400, { message: '该转账单无需审批或已处理' });
    }

    const [reservation] = await tx
      .select({ status: paymentFundReservations.status, version: paymentFundReservations.version })
      .from(paymentFundReservations)
      .where(eq(paymentFundReservations.id, row.fundReservationId))
      .for('update')
      .limit(1);
    if (!reservation) throw new HTTPException(409, { message: '转账资金预占不存在' });
    if (reservation.status !== 'active') {
      throw new HTTPException(409, { message: `转账资金预占已处于 ${reservation.status}` });
    }

    const [updated] = await tx
      .update(paymentTransfers)
      .set({
        approvalStatus: 'rejected',
        approverId: user.userId,
        approvedAt: new Date(),
        approvalRemark: input.remark.trim(),
        status: 'failed',
        failReason: '转账审批被驳回',
        finishedAt: new Date(),
        version: sql`${paymentTransfers.version} + 1`,
      })
      .where(and(
        eq(paymentTransfers.id, row.id),
        eq(paymentTransfers.version, row.version),
        eq(paymentTransfers.status, 'pending'),
        eq(paymentTransfers.approvalStatus, 'pending'),
      ))
      .returning();
    if (!updated) throw new HTTPException(409, { message: '转账审批状态已变化，请刷新后重试' });

    const [released] = await tx
      .update(paymentFundReservations)
      .set({
        status: 'released',
        finalizedAt: new Date(),
        finalizationReason: `转账审批驳回：${input.remark.trim()}`,
        version: sql`${paymentFundReservations.version} + 1`,
      })
      .where(and(
        eq(paymentFundReservations.id, row.fundReservationId),
        eq(paymentFundReservations.status, 'active'),
        eq(paymentFundReservations.version, reservation.version),
      ))
      .returning({ id: paymentFundReservations.id });
    if (!released) throw new HTTPException(409, { message: '转账资金预占状态已变化' });
    return updated;
  });
  return mapTransfer(rejected);
}

/** 主动查询渠道转账结果并同步本地状态（processing 单的兜底纠偏）。 */
export async function syncTransferStatus(id: number): Promise<PaymentTransfer> {
  requireTenantScopeId(currentUser());
  const row = await ensureTransfer(id);
  // Explicit failures are terminal. Querying them again could resurrect a
  // deliberately rejected transfer after its reservation was released.
  if (!['processing', 'unknown'].includes(row.status)) return mapTransfer(row);
  const config = row.channelConfigId
    ? (await db.select().from(paymentChannelConfigs).where(and(
      eq(paymentChannelConfigs.id, row.channelConfigId),
      eq(paymentChannelConfigs.channel, row.channel),
      row.tenantId == null ? isNull(paymentChannelConfigs.tenantId) : eq(paymentChannelConfigs.tenantId, row.tenantId),
    )).limit(1))[0]
    : undefined;
  if (!config) return mapTransfer(row);
  const adapter = getAdapter(row.channel);
  if (!adapter.queryTransfer) return mapTransfer(row);
  let res;
  try {
    assertPaymentEngineConfig(config);
    await assertEffectivePaymentOperation({ configRow: config, operation: 'transfer.query', currency: row.currency, recovery: true });
    res = await adapter.queryTransfer(buildAdapterContext(config), { outTransferNo: row.outTransferNo });
  } catch (err) {
    logger.warn('[payment-transfer] query failed', { transferNo: row.transferNo, err });
    return mapTransfer(row);
  }
  if (res.status === 'processing') return mapTransfer(row);
  if (res.status === 'success') {
    try {
      await recordTransferJournal(row, config);
    } catch (accountingError) {
      logger.error('[payment-transfer] query confirmed success but journal posting failed', { transferNo: row.transferNo, err: accountingError });
      const [pending] = await db
        .update(paymentTransfers)
        .set({
          status: 'unknown',
          channelTransferNo: res.channelTransferNo ?? row.channelTransferNo,
          failReason: '渠道已成功，等待账务凭证落地',
          finishedAt: null,
          version: sql`${paymentTransfers.version} + 1`,
        })
        .where(and(
          eq(paymentTransfers.id, row.id),
          eq(paymentTransfers.version, row.version),
          inArray(paymentTransfers.status, ['processing', 'unknown', 'failed']),
        ))
        .returning();
      return mapTransfer(pending ?? row);
    }
    await finalizeTransferReservation(row, 'captured', `查单确认转账成功 ${res.channelTransferNo ?? row.transferNo}`);
  } else if (res.status === 'failed') {
    await finalizeTransferReservation(row, 'released', '查单确认转账失败');
  }
  const [updated] = await db
    .update(paymentTransfers)
    .set({
      status: res.status,
      channelTransferNo: res.channelTransferNo ?? row.channelTransferNo,
      failReason: res.failReason?.slice(0, 500) ?? row.failReason,
      finishedAt: res.finishedAt ?? new Date(),
      version: sql`${paymentTransfers.version} + 1`,
    })
    .where(and(
      eq(paymentTransfers.id, row.id),
      eq(paymentTransfers.version, row.version),
      inArray(paymentTransfers.status, ['processing', 'unknown', 'failed']),
    ))
    .returning();
  if (!updated) return mapTransfer(row);
  return mapTransfer(updated);
}

/** 同步所有 processing 转账单（cron 兜底）。 */
export async function syncProcessingTransfers(): Promise<{ scanned: number; finished: number }> {
  const rows = await db
    .select()
    .from(paymentTransfers)
    .where(or(
      inArray(paymentTransfers.status, ['processing', 'unknown']),
      and(eq(paymentTransfers.status, 'pending'), eq(paymentTransfers.approvalStatus, 'approved')),
    ))
    .limit(50);
  if (rows.length === 0) return { scanned: 0, finished: 0 };
  // 一批转账单通常只落在少数几份渠道配置上，去重后一次取回，替代逐单点查
  const configIds = [...new Set(rows.map((row) => row.channelConfigId).filter((id): id is number => id != null))];
  const configById = new Map<number, PaymentChannelConfigRow>();
  if (configIds.length > 0) {
    const configs = await db.select().from(paymentChannelConfigs).where(inArray(paymentChannelConfigs.id, configIds));
    for (const cfg of configs) configById.set(cfg.id, cfg);
  }
  let finished = 0;
  for (const row of rows) {
    const config = row.channelConfigId != null ? configById.get(row.channelConfigId) : undefined;
    if (!config || config.channel !== row.channel || (config.tenantId ?? null) !== (row.tenantId ?? null)) {
      logger.warn('[payment-transfer] skipped query with mismatched channel scope', {
        transferNo: row.transferNo,
        channelConfigId: row.channelConfigId,
        channel: row.channel,
        tenantId: row.tenantId ?? null,
      });
      continue;
    }
    const adapter = getAdapter(row.channel);
    try {
      if (row.status === 'pending' && row.approvalStatus === 'approved') {
        await assertEffectivePaymentOperation({ configRow: config, operation: 'transfer.create', currency: row.currency });
        const executed = await executeTransferAtChannel(row, config);
        if (executed.status === 'success' || executed.status === 'failed') finished++;
        continue;
      }
      if (!adapter.queryTransfer) continue;
      assertPaymentEngineConfig(config);
      await assertEffectivePaymentOperation({ configRow: config, operation: 'transfer.query', currency: row.currency, recovery: true });
      const res = await adapter.queryTransfer(buildAdapterContext(config), { outTransferNo: row.outTransferNo });
      if (res.status === 'processing') continue;
      if (res.status === 'success') {
        await recordTransferJournal(row, config);
        await finalizeTransferReservation(row, 'captured', `后台查单确认转账成功 ${res.channelTransferNo ?? row.transferNo}`);
      } else if (res.status === 'failed') {
        await finalizeTransferReservation(row, 'released', '后台查单确认转账失败');
      }
      const [updated] = await db
        .update(paymentTransfers)
        .set({
          status: res.status,
          channelTransferNo: res.channelTransferNo ?? row.channelTransferNo,
          failReason: res.failReason?.slice(0, 500) ?? null,
          finishedAt: res.finishedAt ?? new Date(),
          version: sql`${paymentTransfers.version} + 1`,
        })
        .where(and(
          eq(paymentTransfers.id, row.id),
          eq(paymentTransfers.version, row.version),
          inArray(paymentTransfers.status, ['processing', 'unknown']),
        ))
        .returning();
      if (updated) {
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
  approvalStatus?: PaymentTransferApprovalStatus;
  startTime?: string;
  endTime?: string;
}

export async function listTransfers(q: ListTransfersQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  conds.push(keywordCondition(q.keyword, [paymentTransfers.transferNo, paymentTransfers.receiverAccount]));
  if (q.channel) conds.push(eq(paymentTransfers.channel, q.channel));
  if (q.status) conds.push(eq(paymentTransfers.status, q.status));
  if (q.approvalStatus) conds.push(eq(paymentTransfers.approvalStatus, q.approvalStatus));
  conds.push(...dateRangeConditions(paymentTransfers.createdAt, q.startTime, q.endTime));
  const where = buildWhere(...conds, tenantCondition(paymentTransfers, currentUser()));
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
  const where = buildWhere(...conds, tenantCondition(paymentTransfers, currentUser()));
  const [row] = await db
    .select({
      totalAmount: sql<number>`coalesce(sum(case when ${paymentTransfers.status} = 'success' then ${paymentTransfers.amount} else 0 end),0)`,
      successCount: sql<number>`count(*) filter (where ${paymentTransfers.status} = 'success')`,
      processingCount: sql<number>`count(*) filter (where ${paymentTransfers.status} in ('processing','unknown'))`,
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
