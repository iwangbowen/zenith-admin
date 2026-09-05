import * as z from 'zod';
import { defineSettingsModule } from '../module-def';

/** 支付资金操作的审批阈值（单位：分；0 表示不启用审批） */
export const paymentSettingsSchema = z.object({
  refundApprovalThreshold: z.int().min(0).max(1_000_000_000_000).default(0)
    .meta({ title: '退款审批阈值（分）', description: '单笔退款达到该金额时进入四眼审批；0 表示不启用' }),
  transferApprovalThreshold: z.int().min(0).max(1_000_000_000_000).default(100_000)
    .meta({ title: '转账审批阈值（分）', description: '单笔转账达到该金额时进入四眼审批；0 表示不启用' }),
}).meta({ id: 'Settings.Payment' });

export type PaymentSettings = z.output<typeof paymentSettingsSchema>;

export const paymentSettingsModule = defineSettingsModule({
  schema: paymentSettingsSchema,
  title: '支付风控',
  description: '退款与转账的四眼审批阈值',
  scope: 'tenant',
  feature: 'payment',
  readPermission: 'system:setting:view',
  writePermission: 'system:setting:update',
  sort: 90,
});
