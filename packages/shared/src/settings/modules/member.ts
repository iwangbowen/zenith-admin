import * as z from 'zod';
import { defineSettingsModule } from '../module-def';

/** 会员积分与权益自动化（由后台任务全局执行，故为平台级） */
export const memberSettingsSchema = z.object({
  pointExpireDays: z.int().min(0).max(3650).default(0)
    .meta({ title: '积分不活跃过期天数', description: '账户超过 N 天无任何积分变动时余额自动过期清零（expire 流水可审计）；0 表示永不过期' }),
  birthdayPoints: z.int().min(0).max(1_000_000).default(0)
    .meta({ title: '生日礼积分', description: '生日当天自动发放（每年一次）；0 表示不发放' }),
  birthdayCouponId: z.int().positive().nullable().default(null)
    .meta({ title: '生日礼优惠券模板 ID', description: '生日当天自动发放该券（每年一次）；留空表示不发放' }),
  inviteRewardPoints: z.int().min(0).max(1_000_000).default(0)
    .meta({ title: '邀请奖励积分', description: '新会员通过邀请码注册成功后发给邀请人；0 表示不奖励' }),
}).meta({ id: 'Settings.Member' });

export type MemberSettings = z.output<typeof memberSettingsSchema>;

export const memberSettingsModule = defineSettingsModule({
  schema: memberSettingsSchema,
  title: '会员权益',
  description: '积分过期、生日礼与邀请奖励',
  scope: 'platform',
  feature: 'member',
  readPermission: 'system:setting:view',
  writePermission: 'system:setting:update',
  sort: 60,
});
