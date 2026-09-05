import * as z from 'zod';
import { defineSettingsModule } from '../module-def';

/** 规则引擎治理开关 */
export const rulesSettingsSchema = z.object({
  publishApproval: z.boolean().default(false)
    .meta({ title: '决策表发布审批', description: '四眼原则：开启后发布需先提交申请，由具有「审批发布」权限的其他用户批准后生效' }),
}).meta({ id: 'Settings.Rules' });

export type RulesSettings = z.output<typeof rulesSettingsSchema>;

export const rulesSettingsModule = defineSettingsModule({
  schema: rulesSettingsSchema,
  title: '规则引擎',
  description: '决策表发布审批',
  scope: 'platform',
  feature: 'rules',
  readPermission: 'system:setting:view',
  writePermission: 'system:setting:update',
  // 决策表页面据此决定「发布」按钮走直发还是提审
  visibility: { publishApproval: 'authenticated' },
  sort: 80,
});
