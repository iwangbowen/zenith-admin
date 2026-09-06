import { and, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { PAYMENT_CHANNEL_LABELS } from '@zenith/shared/payment';
import type { PaymentChannel } from '@zenith/shared/payment';
import { db } from '../../db';
import { requireRow } from '../../lib/db-assert';
import { paymentChannelConfigs } from '../../db/schema';
import type { PaymentChannelConfigRow } from '../../db/schema';
import { config } from '../../config';

export function assertPaymentEngineConfig(row: PaymentChannelConfigRow, options?: { recovery?: boolean }): void {
  if (config.payment.engineMode === 'off' && !options?.recovery) {
    throw new HTTPException(503, { message: '支付引擎已关闭，资金操作暂不可用' });
  }
  if (config.payment.engineMode === 'sandbox' && !row.sandbox) {
    throw new HTTPException(403, { message: '当前仅允许使用沙箱商户账户' });
  }
  if (config.payment.engineMode === 'live' && row.sandbox) {
    throw new HTTPException(403, { message: '真实支付模式禁止使用沙箱商户账户' });
  }
}

export async function resolvePaymentChannelConfig(input: {
  channel: PaymentChannel;
  channelConfigId?: number;
  scope?: SQL;
}): Promise<PaymentChannelConfigRow> {
  if (input.channelConfigId) {
    const [row] = await db
      .select()
      .from(paymentChannelConfigs)
      .where(and(eq(paymentChannelConfigs.id, input.channelConfigId), eq(paymentChannelConfigs.status, 'enabled'), input.scope))
      .limit(1);
    requireRow(row, '支付渠道配置不存在');
    assertPaymentEngineConfig(row);
    return row;
  }

  const [row] = await db
    .select()
    .from(paymentChannelConfigs)
    .where(and(
      eq(paymentChannelConfigs.channel, input.channel),
      eq(paymentChannelConfigs.isDefault, true),
      eq(paymentChannelConfigs.status, 'enabled'),
      input.scope,
    ))
    .limit(1);
  if (!row) {
    throw new HTTPException(400, {
      message: `未配置默认${PAYMENT_CHANNEL_LABELS[input.channel]}支付渠道`,
    });
  }
  assertPaymentEngineConfig(row);
  return row;
}
