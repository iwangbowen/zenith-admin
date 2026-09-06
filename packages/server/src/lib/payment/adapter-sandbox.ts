import { HTTPException } from 'hono/http-exception';
import type { PaymentOrderRow } from '../../db/schema';
import type { AdapterContext, ProfitShareReverseInput, ProfitShareReverseQueryResult, ProfitShareReverseResult } from './types';
import { buildSignedSandboxOperation } from './sandbox-operation';

export function requireSandboxOperation(ctx: AdapterContext, operation: string, providerLabel: string): void {
  if (!ctx.config.sandbox) {
    throw new HTTPException(400, { message: `CAPABILITY_UNSUPPORTED: ${providerLabel}/${operation}/live` });
  }
}

export async function sandboxProfitShareReverse(
  ctx: AdapterContext,
  order: PaymentOrderRow,
  input: ProfitShareReverseInput,
  options: { prefix: string; label: string; query?: false },
): Promise<ProfitShareReverseResult>;
export async function sandboxProfitShareReverse(
  ctx: AdapterContext,
  order: PaymentOrderRow,
  input: ProfitShareReverseInput,
  options: { prefix: string; label: string; query: true },
): Promise<ProfitShareReverseQueryResult>;
export async function sandboxProfitShareReverse(
  ctx: AdapterContext,
  order: PaymentOrderRow,
  input: ProfitShareReverseInput,
  options: { prefix: string; label: string; query?: boolean },
): Promise<ProfitShareReverseResult | ProfitShareReverseQueryResult> {
  requireSandboxOperation(ctx, 'profit-sharing.reverse', options.label);
  const signed = buildSignedSandboxOperation(ctx, options.prefix, 'profit-sharing.reverse', {
    orderNo: order.orderNo,
    outSharingNo: input.outSharingNo,
    channelSharingNo: input.channelSharingNo,
    outReversalNo: input.outReversalNo,
    amount: input.amount,
    reason: input.reason,
  });
  await Promise.resolve();
  return options.query
    ? { channelReversalNo: signed.reference, status: 'success', finishedAt: new Date(), raw: signed.raw }
    : { channelReversalNo: signed.reference, status: 'success', raw: signed.raw };
}
