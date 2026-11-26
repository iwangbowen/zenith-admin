import * as z from 'zod';
import { defineSettingsModule } from '../module-def';

/** 行为分析 SDK、错误采集与会话回放的租户级运行时设置。 */
export const analyticsSettingsSchema = z.object({
  enabled: z.boolean().default(true).meta({ title: '启用采集', description: '关闭后不再采集新的行为、性能和错误数据' }),
  sampleRate: z.number().min(0).max(1).default(1).meta({ title: '采样率', description: '行为事件采集比例，0%–100%' }),
  trackPageviews: z.boolean().default(true).meta({ title: '页面浏览' }),
  trackClicks: z.boolean().default(true).meta({ title: '点击行为' }),
  trackPerformance: z.boolean().default(true).meta({ title: '性能指标' }),
  trackErrors: z.boolean().default(true).meta({ title: '错误采集' }),
  trackApi: z.boolean().default(true).meta({ title: 'API 请求' }),
  maskInputs: z.boolean().default(true).meta({ title: '脱敏输入内容' }),
  respectDnt: z.boolean().default(false).meta({ title: '尊重 DNT' }),
  anonymizeIp: z.boolean().default(false).meta({ title: 'IP 匿名化', description: '开启后仅存储网段，地理解析不受影响' }),
  blacklistPaths: z.array(z.string().max(256)).default(() => []).meta({ title: '黑名单路径' }),
  errorIgnorePatterns: z.array(z.string().min(1).max(500)).max(50).default(() => []).meta({ title: '错误忽略规则（正则）', description: '命中错误消息的前端错误不会上报' }),
  retentionDays: z.int().min(1).max(3650).default(180).meta({ title: '事件保留天数' }),
  errorRetentionDays: z.int().min(1).max(3650).default(90).meta({ title: '错误保留天数' }),
  sessionTimeoutMinutes: z.int().min(1).max(1440).default(30).meta({ title: '会话超时分钟' }),
  trackReplay: z.boolean().default(false).meta({ title: '会话回放' }),
  replaySessionSampleRate: z.number().min(0).max(1).default(0).meta({ title: '全程录制采样率' }),
  replayOnError: z.boolean().default(true).meta({ title: '错误触发回放' }),
  replayMaskAllText: z.boolean().default(false).meta({ title: '回放打码所有文本' }),
  replayBlockSelector: z.string().max(256).default('').meta({ title: '回放屏蔽选择器' }),
  replayRetentionDays: z.int().min(1).max(3650).default(30).meta({ title: '回放保留天数' }),
  replayStorageQuotaMb: z.int().min(0).max(1_048_576).default(4096).meta({ title: '回放存储配额（MB）', description: '0 表示不限制' }),
}).meta({ id: 'Settings.Analytics' });

export type AnalyticsSettings = z.output<typeof analyticsSettingsSchema>;

export const analyticsSettingsModule = defineSettingsModule({
  schema: analyticsSettingsSchema,
  title: '数据采集',
  description: '行为事件、错误监控和会话回放采集策略；配置页面位于数据管理',
  scope: 'tenant',
  readPermission: 'analytics:data:view',
  writePermission: 'analytics:manage',
  page: '/analytics/data?tab=settings',
  sort: 125,
});
