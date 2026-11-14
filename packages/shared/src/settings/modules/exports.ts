import * as z from 'zod';
import { defineSettingsModule } from '../module-def';
export const exportsSettingsSchema = z.object({
  maxRows: z.int().min(1).max(1000000).default(500000).meta({ title: '单次最大行数', description: '与业务定义取更小值，超过明确拒绝' }),
  syncMaxRows: z.int().min(0).max(10000).default(5000).meta({ title: '同步最大行数', description: '超出转后台生成' }),
  maxFileMb: z.int().min(1).max(1024).default(128).meta({ title: '产物大小上限(MiB)', description: '流式输出也受字节预算约束' }),
  maxColumns: z.int().min(1).max(512).default(256).meta({ title: '单次最大列数' }),
  dailyJobsPerUser: z.int().min(1).max(10000).default(100).meta({ title: '每用户每天任务数' }),
  schedulingEnabled: z.boolean().default(true).meta({ title: '启用定时导出', description: '停用时暂停周期调度，不影响手动导出' }),
}).meta({ id: 'Settings.Exports' });
export type ExportsSettings = z.output<typeof exportsSettingsSchema>;
export const exportsSettingsModule = defineSettingsModule({ schema: exportsSettingsSchema, title: '导出治理', description: '导出预算、频率与后台调度策略', scope: 'platform', readPermission: 'system:setting:view', writePermission: 'system:setting:update', sort: 45 });
