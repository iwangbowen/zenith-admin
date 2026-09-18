import * as z from 'zod';
import { defineSettingsModule } from '../module-def';

/** 支付资金操作的审批阈值（单位：分；0 表示不启用审批） */
export const paymentSettingsSchema = z.object({
  refundApprovalThreshold: z.int().min(0).max(1_000_000_000_000).default(0)
    .meta({ title: '退款审批阈值（分）', description: '单笔退款达到该金额时进入四眼审批；0 表示不启用' }),
  transferApprovalThreshold: z.int().min(0).max(1_000_000_000_000).default(100_000)
    .meta({ title: '转账审批阈值（分）', description: '单笔转账达到该金额时进入四眼审批；0 表示不启用' }),
  reconEnabled: z.boolean().default(true).meta({ title: '自动渠道对账' }),
  reconDownloadHour: z.int().min(0).max(23).default(10)
    .meta({ title: '次日开始取账小时', description: '渠道账单时区；未出账继续等待，不视作零交易' }),
  reconWaitMinutes: z.int().min(5).max(1440).default(60).meta({ title: '未出账复查间隔（分钟）' }),
  reconDeadlineHours: z.int().min(12).max(720).default(36).meta({ title: '账单逾期时限（小时）' }),
  reconCaseSlaHours: z.int().min(1).max(2160).default(48).meta({ title: '差异处置时限（小时）' }),
  reconAlertUserIds: z.array(z.int().positive()).default([])
    .meta({ title: '对账通知接收人', description: '当前租户用户ID；未配置时发送给业务经办人' }),
  reconApprovalDefinitionId: z.int().positive().nullable().default(null)
    .meta({ title: '资金调整审批流程', description: '已发布的业务系统主导流程；必须包含非申请人的人工审批' }),
}).meta({ id: 'Settings.Payment' });

export type PaymentSettings = z.output<typeof paymentSettingsSchema>;

export const paymentSettingsModule = defineSettingsModule({
  schema: paymentSettingsSchema,
  title: '支付与对账',
  description: '资金审批、自动对账与异常处理策略',
  scope: 'tenant',
  feature: 'payment',
  readPermission: 'system:setting:view',
  writePermission: 'system:setting:update',
  sort: 90,
});
