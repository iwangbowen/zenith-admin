import { createHash } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE, isUnresolvedReconciliationCase, type PaymentReconCaseStatus, type PaymentReconCaseType, type PaymentReconDirection } from '@zenith/shared/payment';

/** JSONB may reorder object keys; evidence hashes must be independent of key order. */
export function reconEvidenceHash(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (typeof input === 'bigint') return input.toString();
    if (input instanceof Date) return input.getTime();
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return input;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
}

export function assertIndependentReconApproval(bizType: string | null | undefined, applicantId: number, actorId: number): void {
  if (bizType !== PAYMENT_RECON_ADJUSTMENT_BIZ_TYPE) return;
  if (!Number.isSafeInteger(actorId) || actorId <= 0 || actorId === applicantId) {
    throw new HTTPException(403, { message: '支付调账必须由申请人以外的真实用户人工审批，禁止本人或自动审批' });
  }
}

export function assertReconAdjustmentAmount(record: {
  type: PaymentReconCaseType; status: PaymentReconCaseStatus; applicationId: number | null;
  localAmount: bigint | null; channelAmount: bigint | null;
}, input: { applicationId: number; amount: string; direction: PaymentReconDirection }) {
  if (!isUnresolvedReconciliationCase(record.status)) throw new HTTPException(409, { message: '仅未解决差异可以申请调账' });
  if (record.type !== 'amount_diff' || record.applicationId == null || record.localAmount == null || record.channelAmount == null) {
    throw new HTTPException(400, { message: '仅有明确本地归属的金额差异可调账；单边、状态及归属差异须先调查或查单补偿' });
  }
  if (record.applicationId !== input.applicationId) throw new HTTPException(400, { message: '调整应用与本地交易归属不一致' });
  const delta = record.channelAmount - record.localAmount;
  const requested = BigInt(input.amount) * (input.direction === 'out' ? -1n : 1n);
  if (delta === 0n || delta !== requested) throw new HTTPException(400, { message: '调整金额和方向必须精确等于渠道金额减本地金额；手续费差异须单独核实' });
}
